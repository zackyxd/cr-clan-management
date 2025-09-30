// producer.js
import { Queue } from 'bullmq';

const myQueue = new Queue('myQueue', {
  connection: { host: '127.0.0.1', port: 6379 }
});

// Add a few jobs
async function addJobs() {
  for (let i = 1; i <= 5; i++) {
    await myQueue.add('printMessage', { message: `Job #${i}` });
    console.log(`Added Job #${i}`);
  }
  await myQueue.close();
}

addJobs();
