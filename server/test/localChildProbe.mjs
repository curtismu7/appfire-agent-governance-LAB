// Test support: loads the real child entry, then does one thing the test asked for (argv[2]), so the test can look at the child from inside.
import '../src/local/main.js';

const mode = process.argv[2];
if (mode === 'env') process.send({ type: 'probe', env: Object.keys(process.env).sort() });
if (mode === 'throw') setTimeout(() => { throw new Error('SENTINEL-VALUE-1234'); }, 50);
if (mode === 'reject') setTimeout(() => { Promise.reject(new Error('SENTINEL-VALUE-1234')); }, 50);
