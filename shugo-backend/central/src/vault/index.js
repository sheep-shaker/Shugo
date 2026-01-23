'use strict';

/**
 * SHUGO v7.0 - Module Vault Central
 *
 * Export centralisé des composants du Vault.
 *
 * @see Document Technique V7.0 - Chapitre 5
 */

const VaultManager = require('./VaultManager');
const KeyStore = require('./KeyStore');
const SecretStore = require('./SecretStore');
const VaultBackup = require('./VaultBackup');

module.exports = {
  VaultManager,
  KeyStore,
  SecretStore,
  VaultBackup
};
