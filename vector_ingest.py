import os
from dotenv import load_dotenv
import pandas as pd
import numpy as np 
import openai
from pinecone import Pinecone, ServerlessSpec
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed
import time # Added for retry delays

# --- Config ---
EXCEL_FILE = "fb_data/cleaned_facebook_posts.xlsx"
ID_COLUMN = "post_id"
EMBED_COLUMN = "post_text"
MAX_PARALLEL_EMBEDDING_REQUESTS = 10 # Number of parallel requests to OpenAI API
OPENAI_EMBEDDING_BATCH_SIZE = 100 # Number of texts to send in a single OpenAI API call
PINECONE_UPSERT_BATCH_SIZE = 100 # Number of vectors to upsert to Pinecone in one go
CHECKPOINT_FILE = "processed_post_ids.txt" # File to store IDs of processed items

# --- API Keys (set in env or fill here) ---
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
# NUM_ROWS = os.getenv("NUM_ROWS",1000) # This was in original, can be re-added if needed
PINECONE_CLOUD = "aws"
PINECONE_REGION = "us-east-1"

# --- Initialize clients ---
openai.api_key = OPENAI_API_KEY
pc = Pinecone(api_key=PINECONE_API_KEY)

index_name = "fb-group-data"

# --- Checkpoint Helper Functions ---
def load_processed_ids(filepath):
    try:
        with open(filepath, 'r') as f:
            return set(line.strip() for line in f if line.strip())
    except FileNotFoundError:
        return set()

def save_processed_ids(ids_to_save, filepath):
    with open(filepath, 'a') as f:
        for id_val in ids_to_save:
            f.write(str(id_val) + '\n')

# --- Helper function for upserting with retries ---
def upsert_with_retry(pinecone_index, vectors_batch, checkpoint_filepath, max_retries=3, initial_delay=5):
    if not vectors_batch:
        return 0 # Nothing to upsert

    retries = 0
    current_delay = initial_delay
    while retries < max_retries:
        try:
            # print(f"Attempting to upsert {len(vectors_batch)} vectors (attempt {retries + 1}/{max_retries})...")
            pinecone_index.upsert(vectors=vectors_batch)
            
            ids_just_upserted = [vec['id'] for vec in vectors_batch]
            save_processed_ids(ids_just_upserted, checkpoint_filepath)
            # print(f"Successfully upserted and checkpointed {len(ids_just_upserted)} IDs.")
            return len(ids_just_upserted) # Return number of successfully processed items

        except Exception as e:
            error_str = str(e).lower()
            is_retryable = any(sub in error_str for sub in ["ssl", "connection", "timeout", "serviceunavailable", "bad_write_retry", "broken pipe", "server error"])
            
            print(f"Upsert failed for a batch (attempt {retries + 1}/{max_retries}): {type(e).__name__} - {e}")
            if is_retryable and retries < max_retries - 1:
                retries += 1
                actual_delay = min(current_delay * (2**retries), 60) # Exponential backoff, capped at 60s
                print(f"Retryable error. Retrying in {actual_delay} seconds...")
                time.sleep(actual_delay)
            elif is_retryable and retries >= max_retries - 1:
                print(f"Max retries ({max_retries}) reached for this batch due to persistent retryable error. Batch will be skipped for this run and retried on next script execution.")
                return 0 # Failed after max retries for retryable error
            else:
                print(f"Non-retryable error during upsert: {type(e).__name__} - {e}. This batch will be skipped for this run and retried on next script execution.")
                return 0 # Failed due to non-retryable error
    return 0 # Should only be reached if loop finishes unexpectedly

# --- Create index if not exists ---
if not pc.has_index(index_name):
    print(f"Index '{index_name}' not found. Creating new index with dimension 3072...")
    pc.create_index(
        name=index_name,
        dimension=3072,  # <<< CHANGED FROM 1536 to 3072
        metric="cosine",
        spec=ServerlessSpec(
            cloud='aws',
            region='us-east-1'
        )
    )
    print(f"Index '{index_name}' created successfully.")
elif pc.describe_index(index_name).dimension != 3072:
    print(f"ERROR: Index '{index_name}' exists but has dimension {pc.describe_index(index_name).dimension} instead of the required 3072.")
    print(f"Please delete the existing '{index_name}' index in your Pinecone console and re-run the script.")
    exit()
else:
    print(f"Index '{index_name}' already exists with correct dimension (3072).")

index = pc.Index(index_name)

# --- Load data ---
df = pd.read_excel(EXCEL_FILE)
# Ensure ID_COLUMN is string type from the start for consistency
df[ID_COLUMN] = df[ID_COLUMN].astype(str)
df = df.dropna(subset=[ID_COLUMN, EMBED_COLUMN])

# --- Resume from checkpoint ---
processed_ids_set = load_processed_ids(CHECKPOINT_FILE)
if processed_ids_set:
    print(f"Found {len(processed_ids_set)} already processed IDs from '{CHECKPOINT_FILE}'. Resuming...")
    original_row_count = len(df)
    df = df[~df[ID_COLUMN].isin(processed_ids_set)]
    skipped_count = original_row_count - len(df)
    if skipped_count > 0:
        print(f"Skipped {skipped_count} rows that were already processed.")
    if not df.empty:
        print(f"Processing {len(df)} new rows.")
    else:
        print("No new rows to process. All data appears to be checkpointed.")
else:
    print(f"No checkpoint file '{CHECKPOINT_FILE}' found or it was empty. Starting fresh processing for {len(df)} rows.")

if df.empty:
    print("✅ No data to process after considering checkpoints. Exiting.")
    exit()

# --- Embedding function ---
def embed(texts_batch): # Takes a batch of texts
    if not texts_batch: # Handle empty batch case
        return []
    res = openai.embeddings.create(
        input=texts_batch,
        model="text-embedding-3-large" # Using the more accurate model as requested
    )
    return [r.embedding for r in res.data]

# --- Prepare data for embedding and upsert ---
print("Preparing data batches for parallel embedding...")
all_text_batches_to_embed = []
all_id_batches = []
all_original_data_batches = [] # Stores corresponding DataFrame slices for metadata

for i in range(0, len(df), OPENAI_EMBEDDING_BATCH_SIZE):
    batch_df_for_openai = df.iloc[i:i+OPENAI_EMBEDDING_BATCH_SIZE]
    
    texts_for_this_openai_batch = batch_df_for_openai[EMBED_COLUMN].tolist()
    # IDs are already string type due to earlier conversion of the column
    ids_for_this_openai_batch = batch_df_for_openai[ID_COLUMN].tolist() 
    
    if not texts_for_this_openai_batch:
        continue
        
    all_text_batches_to_embed.append(texts_for_this_openai_batch)
    all_id_batches.append(ids_for_this_openai_batch)
    all_original_data_batches.append(batch_df_for_openai)

print(f"Generating embeddings in parallel for {len(all_text_batches_to_embed)} batches using up to {MAX_PARALLEL_EMBEDDING_REQUESTS} workers...")
vectors_to_upsert_buffer = []
processed_count_in_run = 0

with ThreadPoolExecutor(max_workers=MAX_PARALLEL_EMBEDDING_REQUESTS) as executor:
    future_to_batch_index = {
        executor.submit(embed, text_batch): i 
        for i, text_batch in enumerate(all_text_batches_to_embed)
    }

    for future in tqdm(as_completed(future_to_batch_index), total=len(all_text_batches_to_embed), desc="Embedding Batches"):
        batch_idx = future_to_batch_index[future]
        try:
            generated_embeddings_for_batch = future.result()
            original_ids_for_this_batch = all_id_batches[batch_idx]
            original_data_df_for_this_batch = all_original_data_batches[batch_idx]

            for item_idx_in_batch, embedding_vector in enumerate(generated_embeddings_for_batch):
                pinecone_id = original_ids_for_this_batch[item_idx_in_batch]
                original_row_data_series = original_data_df_for_this_batch.iloc[item_idx_in_batch]
                
                metadata_payload = {}
                for col_name, value in original_row_data_series.items():
                    original_column_dtype = df[col_name].dtype # Get dtype from the original DataFrame

                    if pd.isna(value):
                        if np.issubdtype(original_column_dtype, np.number):
                            metadata_payload[col_name] = 0  # Default to 0 for missing numbers
                        elif np.issubdtype(original_column_dtype, np.bool_):
                            metadata_payload[col_name] = False # Default to False for missing booleans
                        else: # Assumed to be string/object for other NaNs
                            metadata_payload[col_name] = ""     # Default to empty string for missing text/object
                    elif isinstance(value, bool) or isinstance(value, np.bool_):
                        metadata_payload[col_name] = bool(value)
                    elif isinstance(value, int) or isinstance(value, np.integer):
                        metadata_payload[col_name] = int(value)
                    elif isinstance(value, float) or isinstance(value, np.floating):
                        metadata_payload[col_name] = float(value)
                    elif isinstance(value, str):
                        metadata_payload[col_name] = value
                    elif isinstance(value, list):
                        # Ensure all elements in the list are strings, numbers, or booleans
                        # For simplicity here, converting all to string as per Pinecone's list of strings support
                        metadata_payload[col_name] = [str(elem) for elem in value]
                    else:
                        metadata_payload[col_name] = str(value) # Fallback for other types
                
                vectors_to_upsert_buffer.append({
                    "id": pinecone_id,
                    "values": embedding_vector,
                    "metadata": metadata_payload
                })

                if len(vectors_to_upsert_buffer) >= PINECONE_UPSERT_BATCH_SIZE:
                    if vectors_to_upsert_buffer:
                        succeeded_count = upsert_with_retry(index, vectors_to_upsert_buffer, CHECKPOINT_FILE)
                        if succeeded_count > 0:
                            processed_count_in_run += succeeded_count
                        vectors_to_upsert_buffer = [] # Clear buffer

        except Exception as exc:
            # This catches errors from embedding generation or initial data prep for the batch
            print(f"Error processing batch_idx {batch_idx} (texts: {str(all_text_batches_to_embed[batch_idx][:1])[:100]}...): {type(exc).__name__} - {exc}")
            print(f"This batch (index {batch_idx}) will be skipped and retried on the next script run due to checkpointing.")

# Upsert any remaining vectors in the buffer
if vectors_to_upsert_buffer:
    print(f"Upserting remaining {len(vectors_to_upsert_buffer)} vectors (final batch)...")
    succeeded_count = upsert_with_retry(index, vectors_to_upsert_buffer, CHECKPOINT_FILE)
    if succeeded_count > 0:
        processed_count_in_run += succeeded_count
    vectors_to_upsert_buffer = [] # Clear buffer

print(f"✅ Done: Data upsertion attempts complete. Total {processed_count_in_run} new items confirmed processed and checkpointed in this run.")
