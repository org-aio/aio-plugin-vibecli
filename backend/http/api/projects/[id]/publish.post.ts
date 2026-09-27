import { defineEventHandler } from 'h3';
import { scope } from '../../../../hosting/authentication';
import { body, publishRequest, projectId } from '../../../../projects/http';
import { publish } from '../../../../projects/service';
export default defineEventHandler(async event => {
  const request = await body(event, publishRequest);
  return publish(scope(event), projectId(event), request.expected_updated_at);
});
