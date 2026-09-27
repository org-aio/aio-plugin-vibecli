import { defineEventHandler } from 'h3';
import { scope } from '../../../../hosting/authentication';
import { body, previewRequest, projectId } from '../../../../projects/http';
import { preview } from '../../../../projects/service';
export default defineEventHandler(async event => {
  const request = await body(event, previewRequest);
  return preview(scope(event), projectId(event), request.draft, request.argv);
});
