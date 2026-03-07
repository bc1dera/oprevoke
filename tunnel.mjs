import localtunnel from 'localtunnel';

async function start() {
  const tunnel = await localtunnel({ port: 3000 });
  console.log('Tunnel URL:', tunnel.url);
  tunnel.on('error', (err) => console.error('Tunnel error:', err));
  tunnel.on('close', () => {
    console.log('Tunnel closed, restarting...');
    setTimeout(start, 1000);
  });
}

start();
