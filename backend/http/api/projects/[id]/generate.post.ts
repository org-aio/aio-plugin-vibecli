import { defineEventHandler } from 'h3';
import { scope } from '../../../../hosting/authentication';
import { body, generateRequest, projectId } from '../../../../projects/http';
import { generation } from '../../../../projects/service';
export default defineEventHandler(async event => {
  const request = await body(event, generateRequest);
  return generation(scope(event), projectId(event), request.intent, request.feedback, request.draft);
});
