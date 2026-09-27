import { defineEventHandler } from 'h3';
import { scope } from '../../../hosting/authentication';
import { body, draftRequest, projectId } from '../../../projects/http';
import { save } from '../../../projects/service';
export default defineEventHandler(async event => {
  const request = await body(event, draftRequest);
  return save(scope(event), projectId(event), request.draft, request.expected_updated_at);
});
