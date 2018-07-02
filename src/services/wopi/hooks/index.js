'use strict';

const errors = require('feathers-errors');
const auth = require('feathers-authentication');
const FileModel = require('../../fileStorage/model').fileModel;

/**
 * handles the authentication for wopi-clients, the wopi-specific param 'access-token' has to be a valid jwt for the current system
 * 
 * Excerpt from official documentation: http://wopi.readthedocs.io/projects/wopirest/en/latest/concepts.html
 * "Note that WOPI clients are not required to pass the access token in the Authorization header, but they must send it as a URL parameter in all WOPI operations. 
 * Thus, for maximum compatibility, WOPI hosts should either use the URL parameter in all cases, or fall back to it if the Authorization header is not included 
 * in the request."
 * @param {*} hook 
 */
const wopiAuthentication = hook => {
  hook.params.headers = hook.params.headers || {};
  let jwt = hook.params.headers.authorization || (hook.params.query || {}).access_token; // depends on client
  if (!jwt) throw new Error('access_token is missing!');
  
  hook.params.headers.authorization = jwt;

  return auth.hooks.authenticate('jwt')(hook);
};

/**
 * All editing (POST, PATCH, DELETE) actions should include the wopi-override header!
 */
const retrieveWopiOverrideHeader = hook => {
  hook.params.headers = hook.params.headers || [];
  if (!hook.params.headers['x-wopi-override']) throw new errors.BadRequest("X-WOPI-Override header was not provided or was empty!");
  hook.params.wopiAction = hook.params.headers['x-wopi-override'];
  return hook;
};

/**
 * This helper handles the locking constructure of wopi: https://wopirest.readthedocs.io/en/latest/concepts.html#term-lock
 * following actions should use the locking-helper:
 ** Lock
 ** RefreshLock
 ** Unlock
 ** UnlockAndRelock
 ** PutFile
 * INFORMATION: sometimes wopi-clients not implemented locks! Therefore this hook has to be disabled.
 */
const checkLockHeader = hook => {
  let concerningActions = ['LOCK', 'PUT', 'REFRESH_LOCK', 'UNLOCK'];
  let wopiAction = hook.params.wopiAction;

  if (!concerningActions.includes(wopiAction)) return hook;

  let lockId = hook.params.headers['x-wopi-lock'];
  let fileId = hook.params.fileId;

  // check if lockId is correct for the given file
  return FileModel.findOne({_id: fileId}).then(file => {
    if (!file) throw new errors.NotFound("The requested file was not found!");
    let fileLockId = (file.lockId || "").toString();

    if (fileLockId && fileLockId !== lockId) throw new errors.Conflict("Lock mismatch: The given file could be locked by another wopi-client!");

    return hook;
  });
};

const setLockResponseHeader = hook => {
  hook.result.headerPipes = [{key: 'X-WOPI-Lock', value: hook.result.lockId || ""}];
  return hook;
};

exports.before = {
		all: [wopiAuthentication],
		find: [],
		get: [],
		create: [retrieveWopiOverrideHeader, checkLockHeader],
		update: [retrieveWopiOverrideHeader, checkLockHeader],
		patch: [retrieveWopiOverrideHeader, checkLockHeader],
		remove: [retrieveWopiOverrideHeader, checkLockHeader]
};

exports.after = {
  all: [],
  find: [],
  get: [],
  create: [setLockResponseHeader],
  update: [],
  patch: [],
  remove: []
};