import { defineEventHandler } from 'h3';
import { scope } from '../../../../hosting/authentication';
import { body, invokeRequest, projectId } from '../../../../projects/http';
import { invoke } from '../../../../projects/service';
export default defineEventHandler(async event => {
  const request = await body(event, invokeRequest);
  return invoke(scope(event), projectId(event), request.argv);
});
