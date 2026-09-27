import { defineEventHandler } from 'h3';
import { scope } from '../../../hosting/authentication';
import { body, titleRequest } from '../../../projects/http';
import { create } from '../../../projects/service';
export default defineEventHandler(async event => {
  const request = await body(event, titleRequest);
  return create(scope(event), request.title);
});
