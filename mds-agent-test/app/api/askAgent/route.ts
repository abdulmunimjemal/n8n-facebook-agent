// app/api/askAgent/route.ts
import { type NextRequest, NextResponse } from 'next/server';

// This function handles POST requests to the /api/askAgent endpoint
export async function POST(req: NextRequest) {
  // The n8n webhook URL. Because this code runs on the server,
  // 'localhost' is correct and secure.
  const webhookUrl = 'http://n8n:5678/webhook/ask';

  try {
    const requestBody = await req.json(); // Get the body from the incoming client request
    console.log('Received request body:', requestBody);
    // Forward the request body to the n8n webhook
    const n8nResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody), // Send the same body to n8n
    });

    console.log('n8n webhook response status:', n8nResponse.status);
    if (!n8nResponse.ok) {
      // If n8n gives an error, log it and return an error response
      const errorText = await n8nResponse.text();
      console.error(`n8n webhook failed with status: ${n8nResponse.status}`, errorText);
      return new NextResponse(`Error from n8n webhook: ${errorText}`, { status: n8nResponse.status });
    }

    // Get the raw text response from n8n
    let textData: string;
    try {
      textData = await n8nResponse.json().then(data => data.output || 'No text response from n8n');
    } catch (jsonError) {
      textData = await n8nResponse.text();
      console.error('Failed to parse JSON from n8n response, falling back to text:', jsonError);
      console.warn('Using raw text response from n8n:', textData);
    }

    // Send the raw text back to the client
    return new NextResponse(textData, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });

  } catch (error: any) {
    console.error('API Route Error:', error);
    return new NextResponse(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}
