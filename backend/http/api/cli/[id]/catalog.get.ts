import { defineEventHandler } from 'h3';
import { scope } from '../../../../hosting/authentication';
import { projectId } from '../../../../projects/http';
import { catalog } from '../../../../projects/service';
export default defineEventHandler(event => catalog(scope(event), projectId(event)));
