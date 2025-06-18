"use client";

import React, { useState, useRef } from 'react';
import dynamic from 'next/dynamic';

const AnimatedCanvas = dynamic(
  () => import('@/components/AnimatedCanvas'),
  { ssr: false }
);

const MDSResponseRenderer = ({ text }: { text: string }) => {
  const parts: React.ReactNode[] = [];
  let currentIndex = 0;
  
  // Strict markdown link parser: [text](url)
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > currentIndex) {
      parts.push(text.substring(currentIndex, match.index));
    }
    
    parts.push(
      <a
        key={match.index}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300 hover:underline font-medium transition-colors duration-200"
      >
        {match[1]}
      </a>
    );
    
    currentIndex = linkRegex.lastIndex;
  }
  
  if (currentIndex < text.length) {
    parts.push(text.substring(currentIndex));
  }

  return (
    <div className="text-gray-200 leading-relaxed">
      {parts.length > 0 ? parts : text}
    </div>
  );
};

export default function MDSAgentTestInterface() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleAsk = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!question.trim() || isLoading) return;

    setIsLoading(true);
    setAnswer('');
    setError('');

    try {
      const response = await fetch('/api/askAgent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: "test-session-" + Date.now(),
          action: "sendMessage",
          q: question,
        }),
      });

      const contentType = response.headers.get('content-type');
      const isJson = contentType?.includes('application/json');
      
      if (!response.ok) {
        const errorData = isJson ? await response.json() : await response.text();
        throw new Error(errorData.message || errorData.error || `HTTP error: ${response.status}`);
      }

      const data = isJson ? await response.json() : { output: await response.text() };
      setAnswer(data.output || data.response || 'No response content');

    } catch (err: any) {
      console.error("MDS Agent Error:", err);
      setError(err.message || 'Failed to connect to MDS agent service. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk(e as any);
    }
  };

  return (
    <div className="relative w-full min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center p-4 overflow-hidden">
      <AnimatedCanvas />
      
      <main className="relative z-10 bg-gray-800/80 backdrop-blur-lg rounded-2xl shadow-2xl p-6 sm:p-8 max-w-3xl w-full border border-gray-700 transition-all duration-300">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">
            MDS Agent Test Interface
          </h1>
          <p className="text-gray-400 mt-2 text-sm">Internal Testing Environment • v1.3.5</p>
        </div>

        <form onSubmit={handleAsk} className="space-y-5 mb-6">
          <div className="relative">
            <textarea
              ref={textareaRef}
              className="w-full p-4 bg-gray-900/60 border border-gray-600 rounded-xl text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none resize-none min-h-[140px] transition-all duration-200 shadow-inner backdrop-blur-sm"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about Amazon FBA, certifications, or seller strategies..."
              disabled={isLoading}
              maxLength={500}
              autoFocus
            />
            <div className="absolute bottom-3 right-3 text-xs text-gray-500">
              {question.length}/500
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              className={`flex-1 py-3.5 px-6 rounded-xl font-bold text-white transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-cyan-500 shadow-lg ${
                isLoading 
                  ? 'bg-gradient-to-r from-gray-700 to-gray-600 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500'
              }`}
              disabled={isLoading}
            >
              <div className="flex items-center justify-center">
                {isLoading ? (
                  <>
                    <div className="h-5 w-5 mr-3 border-2 border-t-cyan-400 border-l-cyan-400 border-b-cyan-400 border-r-transparent rounded-full animate-spin" />
                    Querying Agent...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                    Test Agent Response
                  </>
                )}
              </div>
            </button>
            
            <button
              type="button"
              onClick={() => {
                setQuestion('');
                textareaRef.current?.focus();
              }}
              className="py-3.5 px-6 rounded-xl font-medium text-gray-300 bg-gray-700/50 hover:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-gray-500"
            >
              Clear Input
            </button>
          </div>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="p-4 bg-gray-900/40 rounded-lg border border-gray-700">
            <h3 className="font-semibold text-gray-300 mb-2 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-cyan-400" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              </svg>
              Test Examples
            </h3>
            <ul className="text-sm text-gray-400 space-y-1">
              <li className="cursor-pointer hover:text-cyan-300 transition-colors" onClick={() => setQuestion("What's the cheapest certification for organic products?")}>
                • Organic certification cost analysis
              </li>
              <li className="cursor-pointer hover:text-cyan-300 transition-colors" onClick={() => setQuestion("How to handle Amazon suspension?")}>
                • Amazon account suspension process
              </li>
              <li className="cursor-pointer hover:text-cyan-300 transition-colors" onClick={() => setQuestion("Best inventory management strategies")}>
                • FBA inventory management tips
              </li>
            </ul>
          </div>
          
          <div className="p-4 bg-gray-900/40 rounded-lg border border-gray-700">
            <h3 className="font-semibold text-gray-300 mb-2 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Current Features
            </h3>
            <ul className="text-sm text-gray-400">
              <li className="flex items-start">
                <span className="text-green-400 mr-1">•</span> Markdown link parsing
              </li>
              <li className="flex items-start">
                <span className="text-green-400 mr-1">•</span> JSON response handling
              </li>
              <li className="flex items-start">
                <span className="text-green-400 mr-1">•</span> Session-based testing
              </li>
            </ul>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-900/30 rounded-xl border border-red-700/50 animate-fade-in">
            <div className="flex items-center text-red-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <h3 className="font-bold">Agent Error</h3>
            </div>
            <div className="mt-2 text-sm font-mono bg-gray-900/50 p-3 rounded-lg overflow-x-auto">
              {error}
            </div>
          </div>
        )}

        {answer && (
          <div className="mt-6 p-5 bg-gray-900/50 rounded-xl border border-gray-700 animate-fade-in">
            <div className="flex items-center mb-3">
              <div className="bg-gradient-to-r from-cyan-500 to-blue-500 w-8 h-8 rounded-lg flex items-center justify-center mr-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-900" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM7 8H5v2h2V8zm2 0h2v2H9V8zm6 0h-2v2h2V8z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-300 bg-clip-text text-transparent">
                Agent Response
              </h2>
            </div>
            <div className="mt-4 p-4 bg-gray-900/30 rounded-lg border border-gray-700">
              <MDSResponseRenderer text={answer} />
            </div>
          </div>
        )}

        <div className="mt-8 pt-5 border-t border-gray-700/50">
          <div className="flex flex-wrap justify-between items-center text-xs text-gray-500">
            <div>Session: test-session-{Date.now()}</div>
            <div>MDS Agent v1.3.5</div>
            <div>Test Environment</div>
          </div>
        </div>
      </main>
    </div>
  );
}