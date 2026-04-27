-- Stint 51.D — entity display order within a family.
--
-- Diego: "dentro de cualquiera de los distintos submódulos … me gustaría
-- que pudiese desplazar las entidades arriba y abajo para ordenarlas de
-- una manera que a mí me resulte más fácil … obviamente, todo lo que
-- conlleve esa entidad, simplemente para ordenar el listado dentro de
-- una familia."
--
-- Adds a nullable `display_order` integer to tax_entities. NULL = no
-- custom order set (queries fall back to alphabetical legal_name within
-- the family). Once Diego drags an entity, every entity in that family
-- gets a sequential display_order assigned by /api/tax-ops/entities/reorder.
--
-- Index on (client_group_id, display_order, legal_name) covers the matrix
-- ORDER BY clauses without forcing a sort step.

ALTER TABLE tax_entities
  ADD COLUMN IF NOT EXISTS display_order INTEGER;

CREATE INDEX IF NOT EXISTS tax_entities_group_order_idx
  ON tax_entities (client_group_id, display_order NULLS LAST, legal_name)
  WHERE is_active = TRUE;
