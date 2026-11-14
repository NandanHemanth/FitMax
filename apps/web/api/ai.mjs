// Vercel serverless function: POST /api/ai (set NVIDIA_API_KEY in the Vercel project settings).
import { handleAi } from '../server/ai-core.mjs';

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };
export default handleAi;
