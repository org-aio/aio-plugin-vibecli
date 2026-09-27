import { defineEventHandler } from 'h3';
import { scope } from '../../hosting/authentication';
import { settings } from '../../settings/service';
export default defineEventHandler(event => settings().read(scope(event)));
