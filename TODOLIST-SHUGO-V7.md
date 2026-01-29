# SHUGO v7.0 - Liste des Tâches Restantes

## 1. Backend, Frontend, API et Connexion

### Backend Central (Express.js)
- [ ] Corriger le bug de connexion frontend/backend (erreur CORS ou endpoint)
- [ ] Vérifier et tester tous les endpoints API existants
- [ ] Ajouter la validation des données entrantes (Joi/Zod)
- [ ] Implémenter le refresh token automatique
- [ ] Ajouter les logs d'audit complets
- [ ] Configurer les WebSockets pour les notifications temps réel
- [ ] Tester l'API de création d'utilisateur par admin
- [ ] Implémenter la récupération de mot de passe (email)
- [ ] Ajouter le rate limiting par utilisateur

### Frontend (React/Vite)
- [ ] Corriger la page de connexion (LoginPage.tsx)
- [ ] Implémenter la gestion des erreurs API globale
- [ ] Ajouter les intercepteurs Axios pour refresh token
- [ ] Créer les pages manquantes (voir section 2)
- [ ] Implémenter le state management complet (Zustand stores)
- [ ] Ajouter les notifications toast pour feedback utilisateur
- [ ] Responsive design pour mobile
- [ ] Tests unitaires et d'intégration

### Connexion Frontend ↔ Backend
- [ ] Vérifier la configuration CORS
- [ ] Tester tous les appels API depuis le frontend
- [ ] Implémenter la gestion des sessions expirées
- [ ] Ajouter le loading state sur toutes les requêtes
- [ ] Gérer les erreurs réseau gracieusement

---

## 2. Fonctionnalités Utilisateur (Frontend)

### Authentification
- [ ] Page de connexion fonctionnelle
- [ ] Page d'inscription (si applicable)
- [ ] Déconnexion avec nettoyage des tokens
- [ ] Récupération de mot de passe
- [ ] Changement de mot de passe

### Gestion des Utilisateurs (Admin)
- [ ] Liste des utilisateurs avec pagination
- [ ] Création d'utilisateur par admin
- [ ] Modification des informations utilisateur
- [ ] Changement de rôle (Silver → Gold → Platinum)
- [ ] Désactivation/Activation de compte
- [ ] Recherche et filtres utilisateurs

### Gestion des Groupes
- [ ] Liste des groupes
- [ ] Création de groupe
- [ ] Ajout/Suppression de membres
- [ ] Transfert de leadership
- [ ] Quitter un groupe
- [ ] Affichage "Mes groupes"

### Gestion des Localisations
- [ ] Arbre hiérarchique des localisations (geo_id)
- [ ] Création de localisation
- [ ] Modification de localisation
- [ ] Activation/Désactivation
- [ ] Statistiques par localisation

### Notifications
- [ ] Centre de notifications
- [ ] Marquer comme lu/non lu
- [ ] Filtres par type
- [ ] Notifications push (optionnel)

### Tableau de Bord
- [ ] Statistiques globales
- [ ] Activité récente
- [ ] Prochaines gardes (quand serveur local connecté)
- [ ] Alertes et rappels

---

## 3. Déploiement Serveur Central

### Préparation
- [ ] Choisir l'hébergeur (Render, Railway, DigitalOcean, etc.)
- [ ] Configurer PostgreSQL en production (pas SQLite)
- [ ] Variables d'environnement production (.env.production)
- [ ] Certificat SSL/TLS
- [ ] Nom de domaine

### Configuration Production
- [ ] Désactiver le mode développement
- [ ] Configurer les logs de production
- [ ] Mettre en place les backups automatiques
- [ ] Configurer le rate limiting production
- [ ] Sécuriser les endpoints sensibles

### CI/CD
- [ ] GitHub Actions pour déploiement automatique
- [ ] Tests automatisés avant déploiement
- [ ] Rollback automatique en cas d'erreur

### Monitoring
- [ ] Health checks
- [ ] Alertes en cas de panne
- [ ] Métriques de performance
- [ ] Logs centralisés

---

## 4. Serveur Local (Raspberry Pi 5)

### Préparation Raspberry Pi
- [ ] Installation Raspberry Pi OS (64-bit)
- [ ] Configuration réseau (IP fixe ou DHCP réservé)
- [ ] Installation Node.js (v18+)
- [ ] Installation PM2 pour gestion des processus
- [ ] Configuration SSH pour accès distant
- [ ] Sécurisation du Pi (firewall, fail2ban)

### Backend Local (à développer)
- [ ] Créer le projet shugo-backend/local
- [ ] Modèles Guard-related:
  - [ ] Guard (créneaux de garde)
  - [ ] GuardAssignment (inscriptions)
  - [ ] GuardSlot (slots horaires)
  - [ ] GuardScenario (scénarios types)
  - [ ] WaitingList (liste d'attente)
- [ ] API Routes:
  - [ ] GET /guards - Liste des gardes
  - [ ] POST /guards - Créer une garde
  - [ ] POST /guards/:id/assign - S'inscrire
  - [ ] DELETE /guards/:id/unassign - Se désinscrire
  - [ ] GET /guards/my - Mes gardes
  - [ ] GET /scenarios - Scénarios disponibles
- [ ] Synchronisation avec serveur central (Guilty Spark protocol)
- [ ] Authentification via serveur central (JWT validation)

### Connexion Central ↔ Local
- [ ] Enregistrement du serveur local auprès du central
- [ ] Protocole de synchronisation des utilisateurs
- [ ] Heartbeat pour vérifier la disponibilité
- [ ] Gestion du mode hors-ligne
- [ ] Résolution des conflits de données

### Déploiement sur Pi
- [ ] Cloner le repository
- [ ] Configurer les variables d'environnement
- [ ] Initialiser la base de données SQLite locale
- [ ] Configurer PM2 pour démarrage automatique
- [ ] Tester la connexion avec le serveur central

---

## Ordre de Priorité Suggéré

1. **Phase 1 - Stabilisation** (Priorité Haute)
   - Corriger la connexion frontend/backend
   - Tester l'authentification complète
   - Valider les APIs existantes

2. **Phase 2 - Fonctionnalités Core** (Priorité Haute)
   - Pages utilisateur fonctionnelles
   - Gestion des groupes et localisations
   - Dashboard basique

3. **Phase 3 - Déploiement Central** (Priorité Moyenne)
   - Préparer l'environnement production
   - Déployer le serveur central
   - Tester en conditions réelles

4. **Phase 4 - Serveur Local** (Priorité Moyenne)
   - Développer le backend local
   - Configurer le Raspberry Pi
   - Implémenter la synchronisation

5. **Phase 5 - Finalisation** (Priorité Basse)
   - Tests complets
   - Documentation utilisateur
   - Optimisations performance

---

## Informations de Référence

- **Admin Test**: shugopaca@gmail.com / ShugoAdmin2024!
- **Backend Central**: http://localhost:3000
- **Frontend**: http://localhost:5173
- **Repository**: https://github.com/sheep-shaker/Shugo.git
- **Dernier commit**: a693f53

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│    Frontend     │◄───────►│ Serveur Central │
│   (React/Vite)  │   API   │   (Express.js)  │
└─────────────────┘         └────────┬────────┘
                                     │
                                     │ Sync
                                     ▼
                            ┌─────────────────┐
                            │ Serveur Local   │
                            │ (Raspberry Pi)  │
                            └─────────────────┘
```
