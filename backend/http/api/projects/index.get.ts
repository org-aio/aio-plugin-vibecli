import { defineEventHandler } from 'h3';
import { scope } from '../../../hosting/authentication';
import { workspace } from '../../../projects/service';
export default defineEventHandler(event => workspace(scope(event)));
