# Connecter la feuille Google Sheets (sans compte de service)

Cette méthode ne passe pas par Google Cloud, donc la politique qui bloque
les clés de compte de service ne s'applique pas. Tout se fait depuis la
feuille elle-même.

## 1. Créer / ouvrir la feuille

Ouvrez ou créez la feuille Google Sheets qui servira de lien entre les 2 PC.
Notez son nom, par exemple **Magasin**.

## 2. Coller le script

1. Dans la feuille : **Extensions → Apps Script**.
2. Effacez le contenu par défaut et collez tout le contenu du fichier
   `apps-script/Code.gs` (fourni avec l'application).
3. Tout en haut du script, changez cette ligne :
   ```
   var SECRET_KEY = "CHANGE_ME";
   ```
   Remplacez `CHANGE_ME` par un mot de passe de votre choix, par exemple
   `MonMagasin2025!`. Gardez-le, il faudra le retaper dans l'application.
4. **Fichier → Enregistrer** (ou Ctrl+S).

## 3. Publier comme application web

1. En haut à droite : **Déployer → Nouveau déploiement**.
2. Cliquez sur la roue dentée à côté de "Sélectionner le type" → **Application Web**.
3. Réglages :
   - **Exécuter en tant que** : Moi (votre compte)
   - **Qui a accès** : Tout le monde
4. **Déployer**. Google demande d'autoriser le script une première fois :
   acceptez (c'est votre propre script, sur votre propre feuille).
5. Une **URL** apparaît, du type :
   `https://script.google.com/macros/s/AKfycb.../exec`
   **Copiez cette URL.**

## 4. Dans l'application, pour CHAQUE PC

Onglet **Paramètres** :
- **Nom de ce poste** : ex. `Caisse` ou `Stock`
- **Lien de synchronisation** : collez l'URL de l'étape 3
- **Clé de synchronisation** : le mot de passe choisi à l'étape 2
- **Enregistrer les paramètres**, puis **Synchroniser maintenant** pour tester.

Si tout est bon, le message affiche `OK — reçus: 0, envoyés: 0` (ou plus,
s'il y a déjà des produits). Le voyant en haut de l'application passe au vert.

## Si vous modifiez le script plus tard

Après un changement dans `Code.gs`, il faut **Déployer → Gérer les
déploiements → crayon (modifier) → Nouvelle version → Déployer** pour que
le changement prenne effet. L'URL reste la même.

## Onglets lisibles : Produits et Ventes

L'onglet **Events** est le journal technique de la synchronisation (ne pas le modifier).
Le script tient aussi à jour deux onglets lisibles, **Produits** et **Ventes**, à chaque
synchronisation.

La première fois (ou si ces onglets semblent faux) : rechargez la feuille, puis menu
**Candy Shop → Reconstruire Produits et Ventes**. Google demande une autorisation la
première fois : acceptez. Modifier ces onglets à la main ne change rien dans le logiciel ;
faites les changements dans le logiciel.

## Sécurité

N'importe qui connaissant l'URL ET la clé peut lire/écrire les données.
Gardez la clé aussi privée qu'un mot de passe. Pour la changer plus tard :
modifiez `SECRET_KEY` dans le script, redéployez (voir ci-dessus), puis
mettez à jour la clé dans les Paramètres de chaque PC.
