import WebSocket from 'ws';

console.log('Starting Hyperliquid WebSocket Diagnostic Test inside project directory...');
const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

ws.on('open', () => {
  console.log('SUCCESS: Connected to Hyperliquid WebSocket!');
  
  // Subscribe to BTC
  const subMsg = {
    method: 'subscribe',
    subscription: {
      type: 'l2Book',
      coin: 'BTC'
    }
  };
  console.log('Sending subscription message for BTC...');
  ws.send(JSON.stringify(subMsg));
});

let messageCount = 0;
ws.on('message', (data) => {
  messageCount++;
  console.log(`\n[MSG #${messageCount}] Received data packet!`);
  const parsed = JSON.parse(data.toString());
  console.log('Parsed keys:', Object.keys(parsed));
  if (parsed.channel) console.log('Channel:', parsed.channel);
  if (parsed.data) {
    console.log('Coin:', parsed.data.coin);
    console.log('Best Bid:', parsed.data.levels?.[0]?.[0]);
    console.log('Best Ask:', parsed.data.levels?.[1]?.[0]);
  }
  
  if (messageCount >= 3) {
    console.log('\nDiagnostic complete! Successfully received 3 live streams. Closing WebSocket.');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('ERROR in WebSocket:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('WebSocket closed.');
});

setTimeout(() => {
  console.log('TIMEOUT: Did not receive messages within 10 seconds.');
  ws.close();
  process.exit(1);
}, 10000);
