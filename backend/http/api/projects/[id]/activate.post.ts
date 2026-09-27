import { defineEventHandler } from 'h3';
import { scope } from '../../../../hosting/authentication';
import { body, activateRequest, projectId } from '../../../../projects/http';
import { activate } from '../../../../projects/service';
export default defineEventHandler(async event => {
  const request = await body(event, activateRequest);
  return activate(scope(event), projectId(event), request.revision, request.expected_updated_at);
});
