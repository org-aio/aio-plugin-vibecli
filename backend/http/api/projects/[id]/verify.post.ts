import { defineEventHandler } from 'h3';
import { scope } from '../../../../hosting/authentication';
import { body, verifyRequest, projectId } from '../../../../projects/http';
import { verification } from '../../../../projects/service';
export default defineEventHandler(async event => {
  const request = await body(event, verifyRequest);
  return verification(scope(event), projectId(event), request.draft);
});
