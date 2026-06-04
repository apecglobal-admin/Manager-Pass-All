import { createVercelHandler } from '../src/server.js';

let handler;

export default function handleVercelRequest(req, res) {
  handler ||= createVercelHandler();
  return handler(req, res);
}
