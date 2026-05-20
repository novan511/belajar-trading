import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.NVIDIA_API_KEY || '';
console.log('Testing NVIDIA API Key:', apiKey ? 'FOUND (ends with ...' + apiKey.slice(-6) + ')' : 'MISSING');

async function test() {
  const endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
  const model = 'meta/llama-3.1-8b-instruct';
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'user', content: 'Say hello in 1 word' }
        ],
        max_tokens: 10,
        temperature: 0.2
      })
    });

    console.log('Response status:', response.status, response.statusText);
    const body = await response.text();
    console.log('Response body:', body);
  } catch (err) {
    console.error('Error occurred:', err);
  }
}

test();
