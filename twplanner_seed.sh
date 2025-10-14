#!/usr/bin/env bash
set -euo pipefail

PROJECT="TEST.TWPlanner"
DUE="${1:-now+30d}"

# Petite fonction utilitaire pour récupérer le UUID du dernier task créé
last_uuid() {
  task +LATEST _uuid
}

echo "==> Création des tâches dans le projet '$PROJECT' (due=$DUE)"
echo "    Remarque: 'scheduled' n'est PAS défini (pas de verrou),"
echo "    assignee=valentin (pool=pro) sauf Fabrication=exterieur (pool=ext)."

# 10) Faire les plans de la pièce (leaf)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:16h assignee:valentin pool:pro \
  +plans "Faire les plans de la pièce" >/dev/null
UUID_PLANS=$(last_uuid)

# 11) Créer template PV (leaf)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:2h assignee:valentin pool:pro \
  +doc "Créer template PV" >/dev/null
UUID_TEMPLATE=$(last_uuid)

# 3) Créer protocole de test (leaf)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:4h assignee:valentin pool:pro \
  +doc "Créer protocole de test" >/dev/null
UUID_PROTO=$(last_uuid)

# 4) Créer plan d’assemblage du test (leaf)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:4h assignee:valentin pool:pro \
  +plans "Créer plan d’assemblage du test" >/dev/null
UUID_PLAN_ASSY=$(last_uuid)

# 9) Créer la pièce dans l’ERP (depends: PLANS)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:2h assignee:valentin pool:pro \
  depends:$UUID_PLANS "Créer la pièce dans l’ERP" >/dev/null
UUID_ERP=$(last_uuid)

# 8) Lancer l’achat (depends: ERP)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:4h assignee:valentin pool:pro \
  depends:$UUID_ERP "Lancer l’achat" >/dev/null
UUID_ACHAT=$(last_uuid)

# 7) Fabrication de la pièce (depends: ACHAT) - Exterieur (capacité infinie)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:160h assignee:exterieur pool:ext \
  depends:$UUID_ACHAT "Fabrication de la pièce" >/dev/null
UUID_FAB=$(last_uuid)

# 6) Réceptionner la pièce (depends: FAB)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:2h assignee:valentin pool:pro \
  depends:$UUID_FAB "Réceptionner la pièce" >/dev/null
UUID_RECEPT=$(last_uuid)

# 5) Préparer banc d’essai (depends: PLAN_ASSY)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:4h assignee:valentin pool:pro \
  depends:$UUID_PLAN_ASSY "Préparer banc d’essai" >/dev/null
UUID_PREP_BENCH=$(last_uuid)

# 2) Faire le test (depends: RECEPT, PROTO, PREP_BENCH)
task add rc.confirmation=no project:"$PROJECT" \
  estTime:8h assignee:valentin pool:pro \
  depends:$UUID_RECEPT,$UUID_PROTO,$UUID_PREP_BENCH "Faire le test" >/dev/null
UUID_TEST=$(last_uuid)

# 1) PV de test validé (depends: TEST, TEMPLATE) + due
task add rc.confirmation=no project:"$PROJECT" \
  estTime:4h assignee:valentin pool:pro due:"$DUE" \
  depends:$UUID_TEST,$UUID_TEMPLATE +doc "PV de test validé" >/dev/null
UUID_PV=$(last_uuid)

echo "==> Tâches créées."
task project:"$PROJECT" status:pending ls
