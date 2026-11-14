// Usage: npm run qr -- https://your-fitmax-url
// Writes fitmax-qr.png and prints the code in the terminal.
import QRCode from 'qrcode';

const url = process.argv[2];
if (!url || !/^https:\/\//.test(url)) {
  console.error('Pass the public HTTPS URL: npm run qr -- https://your-fitmax-url');
  process.exit(1);
}
await QRCode.toFile('fitmax-qr.png', url, { width: 1024, margin: 2, color: { dark: '#0b0f14', light: '#ffffff' } });
console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
console.log(`Saved fitmax-qr.png for ${url}`);
