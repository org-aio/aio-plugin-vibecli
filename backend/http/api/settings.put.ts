import { defineEventHandler } from 'h3';
import { scope } from '../../hosting/authentication';
import { body } from '../../projects/http';
import { settingsRequest } from '../../settings/model';
import { settings } from '../../settings/service';
export default defineEventHandler(async event => {
  const request = await body(event, settingsRequest);
  return settings().save(scope(event), request);
});
