# Rangeur CC

Petite app Windows qui surveille le dossier Téléchargements et range tout seul le CC des Sims 4 dans le bon dossier `Mods`, avec un aperçu.

## Ce qu'elle fait

- **Trouver du CC** : un onglet pour parcourir TSR avec des rayons clairs (Cheveux › Homme, Meubles › Cuisine, Vêtements › Enfant...), en nouveautés ou par popularité. Depuis fin 2023, TSR range la plupart des nouveautés dans des catégories larges : l'app relit chaque fiche (catégorie, titre, description, mots-clés) et la reclasse. Un clic ouvre la fiche sur TSR, on télécharge là-bas et l'app range le fichier. Elle ne lit que les pages de listes autorisées par le `robots.txt` de TSR, une requête à la fois, avec un cache de 10 minutes.
- Range le CC par catégorie puis sous-catégorie : `Mods/Cheveux/Femme/`, `Mods/Meubles et objets/Salle de bain/`... Catégories : `Mods/Cheveux/`, `Vêtements/`, `Chaussures/`, `Accessoires/`, `Maquillage/`, `Peau et yeux/`, `Meubles et objets/`, `Construction/`, `Poses et animations/`, `Animaux/`, `Mods de gameplay/`, `Lots et Sims/`, `Autres/`. La catégorie vient de la fiche TSR, sinon du contenu du `.package` et du nom. Les mods de script vont dans `Mods/[Script] <Nom>/` car le jeu ignore un `.ts4script` rangé à plus d'un niveau. Option désactivable dans les réglages.
- Détecte chaque `.package`, `.ts4script`, `.zip`, `.rar` ou `.7z` téléchargé, attend la fin du téléchargement, puis :
  - range le CC dans `Mods/<Catégorie>/<Sous-catégorie>/<Nom du CC>/` (sous-catégorie omise si elle est inconnue) ;
  - range les lots, foyers et pièces (`.trayitem`, `.blueprint`, `.bpi`, `.hhi`, `.sgi`, `.householdbinary`, `.room`, `.rmi`) dans `Tray/` ;
  - ignore les archives qui ne contiennent rien pour les Sims ;
  - refuse les doublons.
- Retrouve la page d'origine grâce au flux NTFS `Zone.Identifier` que Windows écrit sur chaque téléchargement, et récupère le titre, le créateur et l'image de la page TSR. Sans page, elle utilise la miniature contenue dans le `.package`.
- Bibliothèque avec recherche, activation et désactivation (déplacement vers `Mods désactivés/`), suppression vers la corbeille.
- Prévient si « Contenu personnalisé et mods » ou « Mods de script » sont désactivés dans le jeu, et peut cocher l'option (jeu fermé, une sauvegarde `Options.ini.rangeurcc.bak` est faite).
- Tourne en arrière-plan dans la zone de notification et se lance avec Windows.
- Trouve le dossier du jeu quelle que soit la langue (le dossier français utilise des espaces insécables) et choisit le plus récemment utilisé s'il y en a plusieurs.

Elle ne contourne rien sur TSR : on télécharge normalement depuis le site, l'app fait le reste.

## Développement

```powershell
npm install
npm start          # lance l'app
npm test           # tests du circuit d'installation (sans Electron)
npm run dist       # génère dist\Rangeur CC Setup x.y.z.exe
```

Bac à sable (aucun vrai dossier touché) :

```powershell
node test/sandbox.js init C:\temp\rcc-sb
$env:RCC_SANDBOX = 'C:\temp\rcc-sb'; npm start
node test/sandbox.js drop C:\temp\rcc-sb   # simule des téléchargements TSR
```

## Structure

- `src/main.js` : processus principal (fenêtre, zone de notification, IPC, file d'installation)
- `src/core/paths.js` : détection du dossier du jeu
- `src/core/watcher.js` : surveillance du dossier Téléchargements
- `src/core/installer.js` : extraction et rangement
- `src/core/taxonomy.js` : arborescence des rayons et reclassement (genre, âge, pièce de la maison)
- `src/core/categorize.js` : choix de la catégorie d'un fichier installé (fiche TSR, contenu du `.package`, nom)
- `src/core/tsr-browse.js` : lecture des listes TSR pour l'onglet « Trouver du CC »
- `src/core/dbpf.js` : lecture des miniatures dans les `.package`
- `src/core/preview.js` : aperçu depuis la page d'origine (TSR et balises `og:`)
- `src/core/options.js` : réglages mods de `Options.ini`
- `src/renderer/` : interface
