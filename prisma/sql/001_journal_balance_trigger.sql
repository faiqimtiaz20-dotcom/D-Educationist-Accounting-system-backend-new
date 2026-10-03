-- Enforce balanced journals: SUM(debit) = SUM(credit) per journal_entry_id
-- Apply after initial Prisma migration (M1 optional hardening; required before M8 production posting).

CREATE OR REPLACE FUNCTION enforce_journal_balanced()
RETURNS TRIGGER AS $$
DECLARE
  entry_id UUID;
  debit_sum NUMERIC(18,2);
  credit_sum NUMERIC(18,2);
BEGIN
  entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  SELECT
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0)
  INTO debit_sum, credit_sum
  FROM journal_lines
  WHERE journal_entry_id = entry_id;

  IF debit_sum <> credit_sum THEN
    RAISE EXCEPTION
      'Journal entry % is unbalanced: debit=% credit=%',
      entry_id, debit_sum, credit_sum;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_journal_balanced();
