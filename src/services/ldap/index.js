const ldap = require('ldapjs');
const errors = require('feathers-errors');

const getLDAPStrategy = require('./strategies');

module.exports = function() {

	/**
	 * A service to communicate with LDAP servers.
	 */
	class LdapService {

		constructor() {
			this.clients = {};
		}

		find(params) {

		}

		_addClient(config, client) {
			this.clients[config._id] = client;
		}

		/**
		 * connect or get a reference to an existing connection
		 * @param {LdapConfig} config
		 * @return {LDAPClient}
		 */
		_getClient(config) {
			let client = this.clients[config._id];
			if (client && client.connected) {
				return Promise.resolve(client);
			} else {
				return this._connect(config).then((client) => {
					this._addClient(config, client);
					return Promise.resolve(client);
				});
			}
		}

		/**
		 * connect to an LDAP server using a search user in the configured root
		 * path
		 * @param {LdapConfig} config
		 * @param {String} username
		 * @param {String} password
		 * @return {Promise} resolves with LDAPClient on successful connection,
		 * rejects with error otherwise
		 */
		_connect(config, username, password) {
			username = username || `uid=${config.searchUser},cn=users,${config.rootPath}`;
			password = password || config.searchUserPassword;

			return new Promise((resolve, reject) => {
				if (! (config && config.url)) {
					reject('Invalid URL in config object.');
				}
				const client = ldap.createClient({
					url: config.url
				});

				client.bind(username, password, (err) => {
					if (err) {
						reject(new errors.NotAuthenticated('Wrong credentials'));
					} else {
						resolve(client);
					}
				});
			});
		}

		/**
		 * close an established connection to a server identified by an LDAP
		 * config
		 * @param {LdapConfig} config
		 * @return {Promise} resolves if successfully disconnected, otherwise
		 * rejects with error
		 */
		_disconnect(config) {
			return new Promise((resolve, reject) => {
				if (! (config && config._id)) {
					reject('Invalid config object');
				}
				this._getClient(config).unbind(function(err) {
					if (err) {
						reject(err);
					}
					resolve();
				});
			});
		}

		/**
		 * authenticate a user via the LDAP server identified by the LDAP config
		 * asociated with the login system
		 * @param {System} system
		 * @param {String} qualifiedUsername - the fully qualified username,
		 * including root path, ou, dn, etc.
		 * @param {String} password
		 * @return {Promise} resolves if successfully logged in, otherwise
		 * rejects with error
		 */
		authenticate(system, qualifiedUsername, password) {
			const config = system.ldapConfig;
			return this._connect(config, qualifiedUsername, password)
				.then(() => {
					const options = {
						filter: null,
						scope: 'sub',
						attributes: []
					};
					const searchString = `${qualifiedUsername}`;
					return this.searchObject(config, searchString, options);
				});
		}

		/**
		 * returns all LDAP objects matching the given search string and options
		 * @param {LdapConfig} config
		 * @param {String} searchString
		 * @param {Object} options
		 * @return {Promise[Array[Object]]} resolves with array of objects
		 * matching the query, rejects with error otherwise
		 */
		searchCollection(config, searchString, options) {
			return this._getClient(config).then((client) => {
				return new Promise((resolve, reject) => {
					let objects = [];
					client.search(searchString, options, function (err, res) {
						if (err) {
							reject(err);
						}
						res.on('error', reject);
						res.on('searchEntry', (entry) => {
							objects.push(entry.object);
						});
						res.on('end', (result) => {
							if (result.status === 0) {
								resolve(objects);
							}
							reject('LDAP result code != 0');
						});
					});
				});
			});
		}

		/**
		 * returns first LDAP object matching the given search string and options
		 * @param {LdapConfig} config
		 * @param {String} searchString
		 * @param {Object} options
		 * @return {Promise[Object]} resolves with object matching the query,
		 * rejects with error otherwise
		 */
		searchObject(config, searchString, options) {
			return this.searchCollection(config, searchString, options)
				.then((objects) => {
					if (objects.length > 0) {
						return Promise.resolve(objects[0]);
					}
					return Promise.reject('Object not found');
				});
		}

		/**
		 * returns all schools on the LDAP server
		 * @param {LdapConfig} config
		 * @return {Promise[Array[Object]]} resolves with all school objects or
		 * rejects with error
		 */
		getSchools(config) {
			const {searchString, options} = getLDAPStrategy(config).getSchoolsQuery();
			return this.searchCollection(config, searchString, options);
		}

		/**
		 * returns all users at a school on the LDAP server
		 * @param {LdapConfig} config
		 * @param {School} school
		 * @return {Promise[Object]} resolves with all user objects or rejects
		 * with error
		 */
		getUsers(config, school) {
			const {searchString, options} = getLDAPStrategy(config).getUsersQuery(school);
			return this.searchCollection(config, searchString, options);
		}

		/**
		 * returns all classes at a school on the LDAP server
		 * @param {LdapConfig} config
		 * @param {School} school
		 * @return {Promise[Object]} resolves with all class objects or rejects
		 * with error
		 */
		getClasses(config, school) {
			const {searchString, options} = getLDAPStrategy(config).getClassesQuery(school);
			return this.searchCollection(config, searchString, options);
		}

		/**
		 * generate an LDAP group object from a team
		 * @param {Team} team
		 * @return {LDAPGroup}
		 */
		_teamToGroup(team) {
			return {
				name: `schulcloud-${team._id}`,
				description: team.name
			};
		}

		/**
		 * add a user to a given team
		 * @param {LdapConfig} config
		 * @param {User}
		 * @param {Team}
		 * @return {Promise} resolves with undefined value rejects with error
		 */
		addUserToTeam(config, user, team) {
			const group = this._teamToGroup(team);
			return getLDAPStrategy(config).addUserToGroup(user, group);
		}

		/**
		 * remove a user from a given team
		 * @param {LdapConfig} config
		 * @param {User}
		 * @param {Team}
		 * @return {Promise} resolves with undefined value rejects with error
		 */
		removeUserFromTeam(config, user, team) {
			const group = this._teamToGroup(team);
			return getLDAPStrategy(config).removeUserFromGroup(user, group);
		}

	}

	const app = this;
	app.use('/ldap', new LdapService());
};
