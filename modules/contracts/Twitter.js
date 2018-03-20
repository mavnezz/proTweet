var private = {}, self = null,
	library = null, modules = null;

function Twitter(cb, _library) {
	self = this;
	self.type = 6
	library = _library;
	cb(null, self);
}

Twitter.prototype.create = function (data, trs) {
	trs.recipientId = data.recipientId;
	trs.asset = {
		tweet: new Buffer(data.tweet, 'utf8').toString('hex') // Save tweet as hex string
	};

	return trs;
}

Twitter.prototype.calculateFee = function (trs) {
	return 0;
}

Twitter.prototype.verify = function (trs, sender, cb, scope) {
	if (trs.asset.tweet.length > 280) {
		return setImmediate(cb, "Max length of a tweet is 140 characters!");
	}

	setImmediate(cb, null, trs);
}

Twitter.prototype.getBytes = function (trs) {
	return new Buffer(trs.asset.tweet, 'hex');
}

Twitter.prototype.apply = function (trs, sender, cb, scope) {
	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		balance: -trs.fee
	}, function (err) {
		if (err) {
			return cb(err);
		}

		modules.blockchain.accounts.addAccount({
			address: trs.recipientId
		});

		return cb();
	});
}

Twitter.prototype.undo = function (trs, sender, cb, scope) {
	modules.blockchain.accounts.undoMerging({
		address: sender.address,
		balance: -trs.fee
	}, cb);
}

Twitter.prototype.applyUnconfirmed = function (trs, sender, cb, scope) {
	if (sender.u_balance < trs.fee) {
		return setImmediate(cb, "Sender doesn't have enough XCR!");
	}

	modules.blockchain.accounts.mergeAccountAndGet({
		address: sender.address,
		u_balance: -trs.fee
	}, cb);
}

Twitter.prototype.undoUnconfirmed = function (trs, sender, cb, scope) {
	modules.blockchain.accounts.undoMerging({
		address: sender.address,
		u_balance: -trs.fee
	}, cb);
}

Twitter.prototype.ready = function (trs, sender, cb, scope) {
	setImmediate(cb);
}

Twitter.prototype.save = function (trs, cb) {
	modules.api.sql.insert({
		table: "asset_tweets",
		values: {
			transactionId: trs.id,
			tweet: trs.asset.tweet
		}
	}, cb);}

Twitter.prototype.dbRead = function (row) {
	if (!row.tw_transactionId) {
		return null;
	} else {
		return {
			tweet: row.tw_tweet
		};
	}
}

Twitter.prototype.normalize = function (asset, cb) {
	library.validator.validate(asset, {
		type: "object", // It is an object
		properties: {
			tweet: { // It contains a tweet property
				type: "string", // It is a string
				format: "hex", // It is in a hexadecimal format
				minLength: 1 // Minimum length of string is 1 character
			}
		},
		required: ["tweet"] // Tweet property is required and must be defined
	}, cb);
}

Twitter.prototype.onBind = function (_modules) {
	modules = _modules;
	modules.logic.transaction.attachAssetType(self.type, self);
}

Twitter.prototype.add = function (cb, query) {
	library.validator.validate(query, {
		type: "object",
		properties: {
			recipientId: {
				type: "string",
				minLength: 1,
				maxLength: 21
			},
			secret: {
				type: "string",
				minLength: 1,
				maxLength: 100
			},
			tweet: {
				type: "string",
				minLength: 1,
				maxLength: 140
			}
		}
	}, function (err) {
		// If error exists, execute callback with error as first argument
		if (err) {
			return cb(err[0].tweet);
		}

		var keypair = modules.api.crypto.keypair(query.secret);
		modules.blockchain.accounts.setAccountAndGet({
			publicKey: keypair.publicKey.toString('hex')
		}, function (err, account) {
			// If error occurs, call cb with error argument
			if (err) {
				return cb(err);
			}

			console.log(account);
			try {
				var transaction = library.modules.logic.transaction.create({
					type: self.type,
					tweet: query.tweet,
					recipientId: query.recipientId,
					sender: account,
					keypair: keypair
				});
			} catch (e) {
				// Catch error if something goes wrong
				return setImmediate(cb, e.toString());
			}

			// Send transaction for processing
			modules.blockchain.transactions.processUnconfirmedTransaction(transaction, cb);
		});
	});
}

Twitter.prototype.list = function (cb, query) {
	// Verify query parameters
	library.validator.validate(query, {
		type: "object",
		properties: {
			recipientId: {
				type: "string",
				minLength: 2,
				maxLength: 21
			}
		},
		required: ["recipientId"]
	}, function (err) {
		if (err) {
			return cb(err[0].tweet);
		}

		// Select from transactions table and join tweets from the asset_tweets table
		modules.api.sql.select({
			table: "transactions",
			alias: "t",
			condition: {
				recipientId: query.recipientId,
				type: self.type
			},
			join: [{
				type: 'left outer',
				table: 'asset_tweets',
				alias: "tw",
				on: {"t.id": "tw.transactionId"}
			}]
		}, ['id', 'type', 'senderId', 'senderPublicKey', 'recipientId', 'amount', 'fee', 'signature', 'blockId', 'transactionId', 'tweet'], function (err, transactions) {
			if (err) {
				return cb(err.toString());
			}

			// Map results to asset object
			var tweets = transactions.map(function (tx) {
				tx.asset = {
					tweet: new Buffer(tx.tweet, 'hex').toString('utf8')
				};

				delete tx.tweet;
				return tx;
			});

			return cb(null, {
				tweets: tweets
			})
		});
	});
}

module.exports = Twitter;
