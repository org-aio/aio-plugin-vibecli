import { defineEventHandler } from 'h3';
import { authenticate } from '../../hosting/authentication';

export default defineEventHandler(event => {
  if (event.path.split('?')[0]?.startsWith('/api/')) {
    event.context.vibecliScope = authenticate(event);
  }
});
