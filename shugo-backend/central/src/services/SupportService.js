'use strict';

/**
 * SHUGO v7.0 - Service Assist'SHUGO (Support Utilisateur Intégré)
 *
 * Gestion complète du support utilisateur avec :
 * - Création et suivi des tickets
 * - Base de connaissances / FAQ automatique
 * - Routage hiérarchique intelligent (Silver→Gold→Platinum→Admin)
 * - Réponses automatisées par bot
 * - Escalade et transfert de tickets
 * - Statistiques et métriques de support
 *
 * @see Document Technique V7.0 - Section 4.3
 */

const { Op } = require('sequelize');

/**
 * Catégories de tickets de support
 */
const TICKET_CATEGORIES = {
  TECHNICAL: 'technical',      // Problèmes techniques
  GUARD: 'guard',              // Questions sur les gardes
  ACCOUNT: 'account',          // Gestion de compte
  BUG: 'bug',                  // Signalement de bug
  FEATURE: 'feature',          // Demande de fonctionnalité
  OTHER: 'other'               // Autre
};

/**
 * Priorités des tickets
 */
const TICKET_PRIORITIES = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent'
};

/**
 * Statuts des tickets
 */
const TICKET_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WAITING_USER: 'waiting_user',
  RESOLVED: 'resolved',
  CLOSED: 'closed'
};

/**
 * Hiérarchie de routage
 */
const ROUTING_HIERARCHY = {
  'Silver': 'Gold',
  'Gold': 'Platinum',
  'Platinum': 'Admin',
  'Admin': 'Admin_N1',
  'Admin_N1': 'Admin_N1'
};

/**
 * Règles de routage par catégorie
 */
const CATEGORY_ROUTING = {
  [TICKET_CATEGORIES.BUG]: 'Admin',
  [TICKET_CATEGORIES.TECHNICAL]: 'Admin',
  [TICKET_CATEGORIES.FEATURE]: 'Admin',
  [TICKET_CATEGORIES.GUARD]: null,      // Utilise la hiérarchie standard
  [TICKET_CATEGORIES.ACCOUNT]: null,
  [TICKET_CATEGORIES.OTHER]: null
};

/**
 * Base de connaissances - FAQ
 */
const KNOWLEDGE_BASE = {
  'mot_de_passe': {
    keywords: ['mot de passe', 'password', 'mdp', 'oublié', 'réinitialiser', 'changer'],
    question: 'Comment réinitialiser mon mot de passe ?',
    answer: `Pour réinitialiser votre mot de passe :
1. Cliquez sur "Mot de passe oublié" sur la page de connexion
2. Entrez votre adresse email
3. Vérifiez votre boîte de réception (et spam)
4. Cliquez sur le lien reçu (valable 1 heure)
5. Définissez votre nouveau mot de passe

Si vous n'avez pas accès à votre email, contactez votre responsable Gold.`,
    category: TICKET_CATEGORIES.ACCOUNT
  },
  '2fa': {
    keywords: ['2fa', 'authentification', 'double', 'otp', 'totp', 'authenticator', 'code'],
    question: 'Comment configurer l\'authentification à deux facteurs ?',
    answer: `L'authentification 2FA est obligatoire pour tous les utilisateurs SHUGO.

Pour configurer :
1. Téléchargez une application authenticator (Google Authenticator, Authy, etc.)
2. Connectez-vous à SHUGO
3. Allez dans Paramètres > Sécurité > 2FA
4. Scannez le QR code avec votre application
5. Entrez le code à 6 chiffres pour valider

Si vous avez perdu l'accès à votre 2FA, contactez votre responsable pour une réinitialisation.`,
    category: TICKET_CATEGORIES.ACCOUNT
  },
  'inscription_garde': {
    keywords: ['inscrire', 'inscription', 'garde', 'planning', 'disponibilité', 'créneau'],
    question: 'Comment m\'inscrire à une garde ?',
    answer: `Pour vous inscrire à une garde :
1. Accédez au Planning des gardes
2. Cliquez sur le créneau souhaité
3. Vérifiez les détails (date, horaires, lieu)
4. Cliquez sur "S'inscrire"
5. Confirmez votre inscription

Notes importantes :
- Les gardes sont confirmées par défaut
- Pour annuler, utilisez le bouton "Annuler" (jusqu'à 24h avant)
- En cas de problème, contactez votre responsable Gold`,
    category: TICKET_CATEGORIES.GUARD
  },
  'annulation_garde': {
    keywords: ['annuler', 'annulation', 'désister', 'garde', 'absence', 'empêché'],
    question: 'Comment annuler ma participation à une garde ?',
    answer: `Pour annuler votre participation :
1. Accédez au Planning > Mes gardes
2. Trouvez la garde concernée
3. Cliquez sur "Annuler ma participation"
4. Indiquez le motif (obligatoire)
5. Confirmez l'annulation

Délais :
- Plus de 24h avant : annulation libre
- Moins de 24h : motif vérifié par responsable
- Jour J : contactez immédiatement votre responsable

Attention : les annulations répétées sont signalées.`,
    category: TICKET_CATEGORIES.GUARD
  },
  'remplacement': {
    keywords: ['remplacement', 'remplacer', 'trouver', 'quelqu\'un', 'échange'],
    question: 'Comment trouver un remplaçant pour ma garde ?',
    answer: `Pour demander un remplacement :
1. Accédez à votre garde
2. Cliquez sur "Demander un remplacement"
3. La demande est envoyée à tous les membres disponibles
4. Attendez une réponse (notification automatique)
5. Validez le remplacement proposé

Alternative : contactez directement un membre et effectuez un échange via l'interface dédiée.`,
    category: TICKET_CATEGORIES.GUARD
  },
  'liste_attente': {
    keywords: ['liste', 'attente', 'complet', 'plein', 'place'],
    question: 'Comment fonctionne la liste d\'attente ?',
    answer: `Quand une garde est complète :
1. Cliquez sur "S'inscrire en liste d'attente"
2. Vous êtes ajouté automatiquement selon l'ordre d'arrivée
3. Si une place se libère, vous recevez une notification
4. Vous êtes inscrit automatiquement (confirmation requise sous 2h)

Priorité sur liste d'attente :
1. Ordre d'inscription
2. Membre avec moins de gardes ce mois
3. Ancienneté (si égalité)`,
    category: TICKET_CATEGORIES.GUARD
  },
  'contact_responsable': {
    keywords: ['responsable', 'gold', 'platinum', 'admin', 'contacter', 'hiérarchie'],
    question: 'Comment contacter mon responsable ?',
    answer: `Votre hiérarchie SHUGO :
- Silver → Gold (responsable de groupe)
- Gold → Platinum (responsable local)
- Platinum → Admin (administrateur)

Pour contacter votre responsable :
1. Menu > Messages > Nouveau message hiérarchique
2. Votre message est automatiquement routé
3. Réponse sous 24-48h en général

En cas d'urgence, utilisez la priorité "Urgent".`,
    category: TICKET_CATEGORIES.OTHER
  },
  'probleme_connexion': {
    keywords: ['connexion', 'connecter', 'login', 'erreur', 'impossible', 'bloqué'],
    question: 'Je n\'arrive pas à me connecter',
    answer: `Vérifications à effectuer :
1. Vérifiez votre email et mot de passe
2. Assurez-vous que le Caps Lock est désactivé
3. Essayez "Mot de passe oublié" si nécessaire
4. Vérifiez que votre code 2FA est correct (synchronisation horaire)

Si votre compte est bloqué :
- Après 5 tentatives : attendre 15 minutes
- Après 10 tentatives : contacter votre responsable

Erreurs courantes :
- "Compte suspendu" : contacter Admin
- "Email non reconnu" : vérifier l'orthographe`,
    category: TICKET_CATEGORIES.TECHNICAL
  }
};

/**
 * Réponses automatiques du bot
 */
const BOT_RESPONSES = {
  greeting: 'Bonjour ! Je suis Assist\'SHUGO, votre assistant virtuel. Comment puis-je vous aider ?',
  no_match: 'Je n\'ai pas trouvé de réponse précise à votre question. Voulez-vous créer un ticket de support ?',
  ticket_created: 'Votre ticket #{ticketId} a été créé et transmis à {assignee}. Vous recevrez une réponse sous 24-48h.',
  ticket_assigned: 'Votre ticket a été assigné à {assignee}. Vous serez notifié de la progression.',
  multiple_matches: 'J\'ai trouvé plusieurs sujets correspondants. Lequel vous intéresse ?'
};

/**
 * Service de support utilisateur intégré (Assist'SHUGO)
 */
class SupportService {
  constructor(models) {
    this.models = models;
    this.SupportRequest = models.SupportRequest;
    this.User = models.User;
    this.AuditLog = models.AuditLog;

    // Services liés (injectés après initialisation)
    this._notificationService = null;
    this._auditService = null;

    // Cache pour les responsables par geo_id
    this._assigneeCache = new Map();
    this._cacheExpiry = 5 * 60 * 1000; // 5 minutes

    // Statistiques en mémoire
    this._stats = {
      ticketsCreated: 0,
      ticketsResolved: 0,
      avgResponseTime: 0,
      botAnswers: 0,
      escalations: 0
    };
  }

  // =========================================
  // INITIALISATION
  // =========================================

  /**
   * Initialise le service de support
   * @param {Object} options - Options d'initialisation
   */
  async initialize(options = {}) {
    const { notificationService, auditService } = options;

    this._notificationService = notificationService;
    this._auditService = auditService;

    // Charger les statistiques initiales depuis la base
    await this._loadStatistics();

    console.log('[SupportService] Initialisé - Assist\'SHUGO prêt');
    return { initialized: true };
  }

  /**
   * Charge les statistiques depuis la base
   * @private
   */
  async _loadStatistics() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const stats = await this.SupportRequest.getStatistics(null, 30);
      this._stats.ticketsCreated = stats.total;
      this._stats.ticketsResolved = stats.byStatus?.resolved || 0;
      this._stats.avgResponseTime = stats.avgResolutionTime || 0;
    } catch (err) {
      console.error('[SupportService] Erreur chargement statistiques:', err.message);
    }
  }

  // =========================================
  // ASSISTANT AUTOMATIQUE (BOT)
  // =========================================

  /**
   * Traite une question utilisateur via le bot
   * @param {string} query - Question de l'utilisateur
   * @param {Object} requester - Utilisateur demandeur
   * @returns {Promise<Object>} - Réponse du bot
   */
  async askBot(query, requester) {
    if (!query || query.trim().length < 3) {
      return {
        type: 'error',
        message: 'Veuillez poser une question plus détaillée (minimum 3 caractères).'
      };
    }

    const normalizedQuery = query.toLowerCase().trim();
    const matches = this._searchKnowledgeBase(normalizedQuery);

    // Log de la requête bot
    await this._logActivity('bot_query', requester.member_id, { query, matchCount: matches.length });
    this._stats.botAnswers++;

    if (matches.length === 0) {
      return {
        type: 'no_match',
        message: BOT_RESPONSES.no_match,
        suggestTicket: true
      };
    }

    if (matches.length === 1) {
      const match = matches[0];
      return {
        type: 'answer',
        question: match.question,
        answer: match.answer,
        category: match.category,
        confidence: match.score,
        relatedTopics: this._getRelatedTopics(match.key)
      };
    }

    // Plusieurs correspondances
    return {
      type: 'multiple',
      message: BOT_RESPONSES.multiple_matches,
      options: matches.slice(0, 5).map(m => ({
        key: m.key,
        question: m.question,
        category: m.category
      }))
    };
  }

  /**
   * Récupère une réponse spécifique de la base de connaissances
   * @param {string} key - Clé de l'article
   * @returns {Object|null}
   */
  getKnowledgeArticle(key) {
    const article = KNOWLEDGE_BASE[key];
    if (!article) return null;

    return {
      key,
      question: article.question,
      answer: article.answer,
      category: article.category,
      relatedTopics: this._getRelatedTopics(key)
    };
  }

  /**
   * Liste tous les articles de la base de connaissances
   * @param {string} category - Filtrer par catégorie
   * @returns {Object[]}
   */
  listKnowledgeBase(category = null) {
    const articles = [];

    for (const [key, article] of Object.entries(KNOWLEDGE_BASE)) {
      if (category && article.category !== category) continue;

      articles.push({
        key,
        question: article.question,
        category: article.category
      });
    }

    return articles;
  }

  /**
   * Recherche dans la base de connaissances
   * @private
   */
  _searchKnowledgeBase(query) {
    const matches = [];
    const queryWords = query.split(/\s+/).filter(w => w.length > 2);

    for (const [key, article] of Object.entries(KNOWLEDGE_BASE)) {
      let score = 0;

      // Vérifier les mots-clés
      for (const keyword of article.keywords) {
        if (query.includes(keyword)) {
          score += 10;
        }
        // Correspondance partielle
        for (const word of queryWords) {
          if (keyword.includes(word) || word.includes(keyword)) {
            score += 3;
          }
        }
      }

      // Vérifier la question
      const questionLower = article.question.toLowerCase();
      for (const word of queryWords) {
        if (questionLower.includes(word)) {
          score += 2;
        }
      }

      if (score > 5) {
        matches.push({
          key,
          ...article,
          score
        });
      }
    }

    // Trier par score décroissant
    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * Récupère les sujets connexes
   * @private
   */
  _getRelatedTopics(currentKey) {
    const current = KNOWLEDGE_BASE[currentKey];
    if (!current) return [];

    const related = [];

    for (const [key, article] of Object.entries(KNOWLEDGE_BASE)) {
      if (key === currentKey) continue;

      // Même catégorie ou mots-clés communs
      if (article.category === current.category) {
        related.push({ key, question: article.question });
      }
    }

    return related.slice(0, 3);
  }

  // =========================================
  // GESTION DES TICKETS
  // =========================================

  /**
   * Crée un nouveau ticket de support
   * @param {Object} data - Données du ticket
   * @param {Object} requester - Utilisateur demandeur
   * @returns {Promise<Object>}
   */
  async createTicket(data, requester) {
    const { category, subject, description, priority = TICKET_PRIORITIES.NORMAL } = data;

    // Validation
    if (!category || !Object.values(TICKET_CATEGORIES).includes(category)) {
      throw new SupportError('INVALID_CATEGORY', 'Catégorie invalide');
    }

    if (!subject || subject.length < 5 || subject.length > 200) {
      throw new SupportError('INVALID_SUBJECT', 'Le sujet doit contenir entre 5 et 200 caractères');
    }

    if (!description || description.length < 10) {
      throw new SupportError('INVALID_DESCRIPTION', 'La description doit contenir au moins 10 caractères');
    }

    // Déterminer le destinataire
    const assignee = await this._determineAssignee(requester, category);

    // Créer le ticket
    const ticket = await this.SupportRequest.create({
      requester_member_id: requester.member_id,
      assigned_to_member_id: assignee?.member_id || null,
      category,
      subject,
      description,
      priority,
      status: TICKET_STATUS.OPEN
    });

    this._stats.ticketsCreated++;

    // Notifications
    if (this._notificationService && assignee) {
      await this._notificationService.send(
        assignee.member_id,
        'SUPPORT_TICKET_CREATED',
        {
          ticketId: ticket.request_id,
          subject,
          category,
          priority,
          requesterName: `${requester.first_name_encrypted} ${requester.last_name_encrypted}`
        },
        { priority: priority === TICKET_PRIORITIES.URGENT ? 'urgent' : 'normal' }
      );
    }

    // Notification au demandeur
    if (this._notificationService) {
      await this._notificationService.send(
        requester.member_id,
        'SUPPORT_TICKET_CREATED',
        {
          ticketId: ticket.request_id,
          subject,
          assigneeName: assignee ? 'votre responsable' : 'en attente d\'assignation'
        }
      );
    }

    // Audit log
    await this._logActivity('ticket_created', requester.member_id, {
      ticketId: ticket.request_id,
      category,
      priority,
      assignedTo: assignee?.member_id
    });

    return {
      ticket: {
        id: ticket.request_id,
        category: ticket.category,
        subject: ticket.subject,
        priority: ticket.priority,
        status: ticket.status,
        createdAt: ticket.created_at
      },
      assignee: assignee ? {
        memberId: assignee.member_id,
        role: assignee.role
      } : null,
      message: BOT_RESPONSES.ticket_created
        .replace('{ticketId}', ticket.request_id.slice(0, 8))
        .replace('{assignee}', assignee ? 'votre responsable' : 'l\'équipe support')
    };
  }

  /**
   * Met à jour un ticket existant
   * @param {string} ticketId - ID du ticket
   * @param {Object} updates - Mises à jour
   * @param {Object} actor - Utilisateur effectuant la mise à jour
   * @returns {Promise<Object>}
   */
  async updateTicket(ticketId, updates, actor) {
    const ticket = await this.SupportRequest.findByPk(ticketId, {
      include: ['requester', 'assignee']
    });

    if (!ticket) {
      throw new SupportError('TICKET_NOT_FOUND', 'Ticket non trouvé');
    }

    // Vérifier les permissions
    const canUpdate = this._canActOnTicket(ticket, actor);
    if (!canUpdate) {
      throw new SupportError('UNAUTHORIZED', 'Non autorisé à modifier ce ticket');
    }

    const allowedUpdates = ['priority', 'status'];
    const actualUpdates = {};

    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        actualUpdates[key] = updates[key];
      }
    }

    // Ajouter une note si fournie
    if (updates.note) {
      const timestamp = new Date().toISOString();
      const note = `\n\n[NOTE ${timestamp} - ${actor.role}] ${updates.note}`;
      actualUpdates.description = (ticket.description || '') + note;
    }

    await ticket.update(actualUpdates);

    // Audit
    await this._logActivity('ticket_updated', actor.member_id, {
      ticketId,
      updates: actualUpdates
    });

    return ticket;
  }

  /**
   * Ajoute une réponse à un ticket
   * @param {string} ticketId - ID du ticket
   * @param {string} response - Texte de la réponse
   * @param {Object} actor - Utilisateur répondant
   * @returns {Promise<Object>}
   */
  async addResponse(ticketId, response, actor) {
    const ticket = await this.SupportRequest.findByPk(ticketId, {
      include: ['requester', 'assignee']
    });

    if (!ticket) {
      throw new SupportError('TICKET_NOT_FOUND', 'Ticket non trouvé');
    }

    // Vérifier les permissions
    const canRespond = this._canActOnTicket(ticket, actor) ||
                       ticket.requester_member_id === actor.member_id;
    if (!canRespond) {
      throw new SupportError('UNAUTHORIZED', 'Non autorisé à répondre à ce ticket');
    }

    // Ajouter la réponse
    const timestamp = new Date().toISOString();
    const isRequester = ticket.requester_member_id === actor.member_id;
    const label = isRequester ? 'UTILISATEUR' : actor.role;
    const formattedResponse = `\n\n[RÉPONSE ${timestamp} - ${label}]\n${response}`;

    const newDescription = (ticket.description || '') + formattedResponse;

    // Mettre à jour le statut si nécessaire
    const newStatus = isRequester ? TICKET_STATUS.OPEN : TICKET_STATUS.WAITING_USER;

    await ticket.update({
      description: newDescription,
      status: newStatus
    });

    // Notifier l'autre partie
    const recipientId = isRequester ? ticket.assigned_to_member_id : ticket.requester_member_id;
    if (this._notificationService && recipientId) {
      await this._notificationService.send(
        recipientId,
        'SUPPORT_TICKET_ASSIGNED',
        {
          ticketId: ticket.request_id,
          subject: ticket.subject,
          message: 'Nouvelle réponse sur votre ticket'
        }
      );
    }

    await this._logActivity('ticket_response', actor.member_id, {
      ticketId,
      isRequester
    });

    return ticket;
  }

  /**
   * Résout un ticket
   * @param {string} ticketId - ID du ticket
   * @param {string} resolution - Description de la résolution
   * @param {Object} actor - Utilisateur résolvant
   * @returns {Promise<Object>}
   */
  async resolveTicket(ticketId, resolution, actor) {
    const ticket = await this.SupportRequest.findByPk(ticketId, {
      include: ['requester']
    });

    if (!ticket) {
      throw new SupportError('TICKET_NOT_FOUND', 'Ticket non trouvé');
    }

    if (!this._canActOnTicket(ticket, actor)) {
      throw new SupportError('UNAUTHORIZED', 'Non autorisé à résoudre ce ticket');
    }

    await ticket.resolve(resolution);
    this._stats.ticketsResolved++;

    // Notifier le demandeur
    if (this._notificationService) {
      await this._notificationService.send(
        ticket.requester_member_id,
        'SUPPORT_TICKET_RESOLVED',
        {
          ticketId: ticket.request_id,
          subject: ticket.subject,
          resolution
        }
      );
    }

    await this._logActivity('ticket_resolved', actor.member_id, {
      ticketId,
      resolution
    });

    return ticket;
  }

  /**
   * Ferme un ticket
   * @param {string} ticketId - ID du ticket
   * @param {Object} actor - Utilisateur fermant
   * @returns {Promise<Object>}
   */
  async closeTicket(ticketId, actor) {
    const ticket = await this.SupportRequest.findByPk(ticketId);

    if (!ticket) {
      throw new SupportError('TICKET_NOT_FOUND', 'Ticket non trouvé');
    }

    // Le demandeur ou le responsable peut fermer
    const canClose = ticket.requester_member_id === actor.member_id ||
                     this._canActOnTicket(ticket, actor);
    if (!canClose) {
      throw new SupportError('UNAUTHORIZED', 'Non autorisé à fermer ce ticket');
    }

    await ticket.close();

    await this._logActivity('ticket_closed', actor.member_id, { ticketId });

    return ticket;
  }

  // =========================================
  // ESCALADE ET TRANSFERT
  // =========================================

  /**
   * Escalade un ticket au niveau supérieur
   * @param {string} ticketId - ID du ticket
   * @param {string} reason - Motif d'escalade
   * @param {Object} actor - Utilisateur escaladant
   * @returns {Promise<Object>}
   */
  async escalateTicket(ticketId, reason, actor) {
    const ticket = await this.SupportRequest.findByPk(ticketId, {
      include: ['requester', 'assignee']
    });

    if (!ticket) {
      throw new SupportError('TICKET_NOT_FOUND', 'Ticket non trouvé');
    }

    if (!this._canActOnTicket(ticket, actor)) {
      throw new SupportError('UNAUTHORIZED', 'Non autorisé à escalader ce ticket');
    }

    // Déterminer le nouveau responsable (niveau supérieur)
    const currentAssignee = ticket.assignee;
    const nextLevel = ROUTING_HIERARCHY[currentAssignee?.role || actor.role];

    if (!nextLevel || nextLevel === currentAssignee?.role) {
      throw new SupportError('NO_ESCALATION', 'Escalade impossible - niveau maximum atteint');
    }

    // Trouver un responsable du niveau supérieur
    const newAssignee = await this._findAssigneeByRole(nextLevel, ticket.requester?.geo_id);

    if (!newAssignee) {
      throw new SupportError('NO_ASSIGNEE', `Aucun ${nextLevel} disponible pour l'escalade`);
    }

    await ticket.escalate(newAssignee.member_id, reason);
    this._stats.escalations++;

    // Notifier le nouveau responsable
    if (this._notificationService) {
      await this._notificationService.send(
        newAssignee.member_id,
        'SUPPORT_TICKET_ASSIGNED',
        {
          ticketId: ticket.request_id,
          subject: ticket.subject,
          message: `Ticket escaladé : ${reason}`,
          previousHandler: currentAssignee?.member_id
        },
        { priority: 'high' }
      );
    }

    await this._logActivity('ticket_escalated', actor.member_id, {
      ticketId,
      reason,
      from: currentAssignee?.member_id,
      to: newAssignee.member_id,
      newLevel: nextLevel
    });

    return {
      ticket,
      newAssignee: {
        memberId: newAssignee.member_id,
        role: newAssignee.role
      }
    };
  }

  /**
   * Transfère un ticket à un autre responsable
   * @param {string} ticketId - ID du ticket
   * @param {number} newAssigneeMemberId - ID du nouveau responsable
   * @param {string} reason - Motif du transfert
   * @param {Object} actor - Utilisateur transférant
   * @returns {Promise<Object>}
   */
  async transferTicket(ticketId, newAssigneeMemberId, reason, actor) {
    const ticket = await this.SupportRequest.findByPk(ticketId, {
      include: ['assignee']
    });

    if (!ticket) {
      throw new SupportError('TICKET_NOT_FOUND', 'Ticket non trouvé');
    }

    if (!this._canActOnTicket(ticket, actor)) {
      throw new SupportError('UNAUTHORIZED', 'Non autorisé à transférer ce ticket');
    }

    // Vérifier que le nouveau responsable existe et a le rôle approprié
    const newAssignee = await this.User.findByPk(newAssigneeMemberId);
    if (!newAssignee) {
      throw new SupportError('ASSIGNEE_NOT_FOUND', 'Nouveau responsable non trouvé');
    }

    const allowedRoles = ['Gold', 'Platinum', 'Admin', 'Admin_N1'];
    if (!allowedRoles.includes(newAssignee.role)) {
      throw new SupportError('INVALID_ASSIGNEE', 'Le destinataire doit être Gold, Platinum ou Admin');
    }

    const previousAssigneeId = ticket.assigned_to_member_id;

    // Ajouter note de transfert
    const timestamp = new Date().toISOString();
    const transferNote = `\n\n[TRANSFERT ${timestamp}] De ${actor.role} vers ${newAssignee.role}. Motif: ${reason}`;

    await ticket.update({
      assigned_to_member_id: newAssigneeMemberId,
      description: (ticket.description || '') + transferNote
    });

    // Notifier le nouveau responsable
    if (this._notificationService) {
      await this._notificationService.send(
        newAssigneeMemberId,
        'SUPPORT_TICKET_ASSIGNED',
        {
          ticketId: ticket.request_id,
          subject: ticket.subject,
          message: `Ticket transféré : ${reason}`
        }
      );
    }

    await this._logActivity('ticket_transferred', actor.member_id, {
      ticketId,
      from: previousAssigneeId,
      to: newAssigneeMemberId,
      reason
    });

    return ticket;
  }

  // =========================================
  // RECHERCHE ET LISTE
  // =========================================

  /**
   * Récupère les tickets d'un utilisateur
   * @param {number} memberId - ID de l'utilisateur
   * @param {Object} options - Options de filtre
   * @returns {Promise<Object>}
   */
  async getTicketsForUser(memberId, options = {}) {
    const { status, page = 1, limit = 20 } = options;

    const where = { requester_member_id: memberId };
    if (status) {
      where.status = status;
    }

    const { count, rows } = await this.SupportRequest.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit,
      include: [{
        association: 'assignee',
        attributes: ['member_id', 'role']
      }]
    });

    return {
      tickets: rows.map(t => ({
        id: t.request_id,
        category: t.category,
        subject: t.subject,
        priority: t.priority,
        status: t.status,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        resolvedAt: t.resolved_at,
        assignee: t.assignee ? { role: t.assignee.role } : null
      })),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  /**
   * Récupère les tickets assignés à un responsable
   * @param {number} memberId - ID du responsable
   * @param {Object} options - Options de filtre
   * @returns {Promise<Object>}
   */
  async getAssignedTickets(memberId, options = {}) {
    const { status, priority, page = 1, limit = 20 } = options;

    const tickets = await this.SupportRequest.getPendingForAssignee(memberId, { priority });

    return {
      tickets: tickets.map(t => ({
        id: t.request_id,
        category: t.category,
        subject: t.subject,
        priority: t.priority,
        status: t.status,
        createdAt: t.created_at,
        requester: t.requester ? {
          memberId: t.requester.member_id,
          role: t.requester.role
        } : null
      })),
      count: tickets.length
    };
  }

  /**
   * Recherche des tickets
   * @param {Object} criteria - Critères de recherche
   * @param {Object} actor - Utilisateur effectuant la recherche
   * @returns {Promise<Object>}
   */
  async searchTickets(criteria, actor) {
    const { query, category, status, priority, dateFrom, dateTo, page = 1, limit = 20 } = criteria;

    const where = {};

    // Restreindre selon le rôle
    if (actor.role === 'Silver') {
      where.requester_member_id = actor.member_id;
    } else if (actor.role === 'Gold') {
      // Gold voit les tickets de son groupe + les siens
      where[Op.or] = [
        { requester_member_id: actor.member_id },
        { assigned_to_member_id: actor.member_id }
      ];
    }
    // Platinum et Admin voient tous les tickets

    if (category) {
      where.category = category;
    }

    if (status) {
      where.status = Array.isArray(status) ? { [Op.in]: status } : status;
    }

    if (priority) {
      where.priority = priority;
    }

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at[Op.gte] = new Date(dateFrom);
      if (dateTo) where.created_at[Op.lte] = new Date(dateTo);
    }

    if (query) {
      where[Op.or] = [
        { subject: { [Op.iLike]: `%${query}%` } },
        { description: { [Op.iLike]: `%${query}%` } }
      ];
    }

    const { count, rows } = await this.SupportRequest.findAndCountAll({
      where,
      order: [
        ['priority', 'DESC'],
        ['created_at', 'DESC']
      ],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit,
      include: ['requester', 'assignee']
    });

    return {
      tickets: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  /**
   * Récupère un ticket par ID
   * @param {string} ticketId - ID du ticket
   * @param {Object} actor - Utilisateur demandant
   * @returns {Promise<Object>}
   */
  async getTicket(ticketId, actor) {
    const ticket = await this.SupportRequest.findByPk(ticketId, {
      include: ['requester', 'assignee']
    });

    if (!ticket) {
      throw new SupportError('TICKET_NOT_FOUND', 'Ticket non trouvé');
    }

    // Vérifier l'accès
    const canView = ticket.requester_member_id === actor.member_id ||
                    ticket.assigned_to_member_id === actor.member_id ||
                    ['Platinum', 'Admin', 'Admin_N1'].includes(actor.role);

    if (!canView) {
      throw new SupportError('UNAUTHORIZED', 'Non autorisé à voir ce ticket');
    }

    return {
      id: ticket.request_id,
      category: ticket.category,
      subject: ticket.subject,
      description: ticket.description,
      priority: ticket.priority,
      status: ticket.status,
      resolution: ticket.resolution,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      resolvedAt: ticket.resolved_at,
      requester: ticket.requester ? {
        memberId: ticket.requester.member_id,
        role: ticket.requester.role
      } : null,
      assignee: ticket.assignee ? {
        memberId: ticket.assignee.member_id,
        role: ticket.assignee.role
      } : null
    };
  }

  // =========================================
  // STATISTIQUES
  // =========================================

  /**
   * Récupère les statistiques de support
   * @param {string} geoId - Filtrer par geo_id
   * @param {number} period - Période en jours
   * @returns {Promise<Object>}
   */
  async getStatistics(geoId = null, period = 30) {
    const stats = await this.SupportRequest.getStatistics(geoId, period);

    return {
      ...stats,
      ...this._stats,
      knowledgeBaseSize: Object.keys(KNOWLEDGE_BASE).length
    };
  }

  /**
   * Récupère les métriques de performance du support
   * @returns {Promise<Object>}
   */
  async getPerformanceMetrics() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Tickets par catégorie
    const byCategory = await this.SupportRequest.findAll({
      where: {
        created_at: { [Op.gte]: thirtyDaysAgo }
      },
      attributes: [
        'category',
        [this.models.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['category']
    });

    // Temps de réponse moyen par responsable
    const responseTimeByAssignee = await this.SupportRequest.findAll({
      where: {
        resolved_at: { [Op.ne]: null },
        created_at: { [Op.gte]: thirtyDaysAgo }
      },
      attributes: [
        'assigned_to_member_id',
        [this.models.sequelize.fn('AVG',
          this.models.sequelize.literal('EXTRACT(EPOCH FROM (resolved_at - created_at))')
        ), 'avg_resolution_seconds']
      ],
      group: ['assigned_to_member_id'],
      include: [{
        association: 'assignee',
        attributes: ['role']
      }]
    });

    // Taux de résolution
    const total = await this.SupportRequest.count({
      where: { created_at: { [Op.gte]: thirtyDaysAgo } }
    });
    const resolved = await this.SupportRequest.count({
      where: {
        created_at: { [Op.gte]: thirtyDaysAgo },
        status: { [Op.in]: ['resolved', 'closed'] }
      }
    });

    return {
      period: 30,
      byCategory: byCategory.map(c => ({
        category: c.category,
        count: parseInt(c.get('count'))
      })),
      responseTimeByAssignee: responseTimeByAssignee.map(r => ({
        memberId: r.assigned_to_member_id,
        role: r.assignee?.role,
        avgHours: Math.round(parseFloat(r.get('avg_resolution_seconds')) / 3600)
      })),
      resolutionRate: total > 0 ? Math.round((resolved / total) * 100) : 0,
      total,
      resolved,
      botUsage: this._stats.botAnswers,
      escalations: this._stats.escalations
    };
  }

  // =========================================
  // MÉTHODES PRIVÉES
  // =========================================

  /**
   * Détermine le responsable approprié pour un ticket
   * @private
   */
  async _determineAssignee(requester, category) {
    // Vérifier le routage par catégorie
    const directRole = CATEGORY_ROUTING[category];

    if (directRole) {
      return this._findAssigneeByRole(directRole, requester.geo_id);
    }

    // Utiliser la hiérarchie standard
    const targetRole = ROUTING_HIERARCHY[requester.role] || 'Gold';
    return this._findAssigneeByRole(targetRole, requester.geo_id);
  }

  /**
   * Trouve un responsable par rôle et geo_id
   * @private
   */
  async _findAssigneeByRole(role, geoId) {
    // Vérifier le cache
    const cacheKey = `${role}_${geoId}`;
    const cached = this._assigneeCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.user;
    }

    // Rechercher en base
    const where = {
      role,
      status: 'active'
    };

    // Pour Gold, filtrer par geo_id
    if (role === 'Gold' && geoId) {
      where.geo_id = geoId;
    }

    const assignee = await this.User.findOne({
      where,
      order: [['created_at', 'ASC']] // Premier créé
    });

    // Mettre en cache
    if (assignee) {
      this._assigneeCache.set(cacheKey, {
        user: assignee,
        expiry: Date.now() + this._cacheExpiry
      });
    }

    return assignee;
  }

  /**
   * Vérifie si un utilisateur peut agir sur un ticket
   * @private
   */
  _canActOnTicket(ticket, actor) {
    // Le responsable assigné
    if (ticket.assigned_to_member_id === actor.member_id) {
      return true;
    }

    // Les admins peuvent tout faire
    if (['Admin', 'Admin_N1'].includes(actor.role)) {
      return true;
    }

    // Platinum peut agir sur les tickets de son geo_id
    if (actor.role === 'Platinum') {
      return true; // Simplification - en production, vérifier le geo_id
    }

    return false;
  }

  /**
   * Log une activité support
   * @private
   */
  async _logActivity(action, memberId, data) {
    try {
      if (this._auditService) {
        await this._auditService.logOperation(action, {
          memberId,
          module: 'support',
          ...data
        });
      }
    } catch (err) {
      console.error('[SupportService] Erreur audit:', err.message);
    }
  }
}

/**
 * Classe d'erreur support
 */
class SupportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SupportError';
    this.code = code;
  }
}

module.exports = SupportService;
module.exports.SupportError = SupportError;
module.exports.TICKET_CATEGORIES = TICKET_CATEGORIES;
module.exports.TICKET_PRIORITIES = TICKET_PRIORITIES;
module.exports.TICKET_STATUS = TICKET_STATUS;
module.exports.KNOWLEDGE_BASE = KNOWLEDGE_BASE;
module.exports.BOT_RESPONSES = BOT_RESPONSES;
