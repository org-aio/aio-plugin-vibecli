import { defineEventHandler } from 'h3';
import { scope } from '../../../hosting/authentication';
import { projectId } from '../../../projects/http';
import { get } from '../../../projects/service';
export default defineEventHandler(event => get(scope(event), projectId(event)));
