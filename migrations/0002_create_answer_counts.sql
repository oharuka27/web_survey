-- Keep per-choice totals so the dashboard reads a handful of rows instead of scanning every response.
CREATE TABLE IF NOT EXISTS answer_counts (
  question INTEGER NOT NULL,
  choice INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (question, choice)
);

INSERT INTO answer_counts (question, choice, count)
SELECT CAST(answer.key AS INTEGER), answer.value, COUNT(*)
FROM responses, json_each(responses.answers) AS answer
GROUP BY answer.key, answer.value;

-- Fires only for rows actually inserted, so duplicate tokens (ON CONFLICT DO NOTHING) are not counted.
CREATE TRIGGER IF NOT EXISTS responses_count_answers AFTER INSERT ON responses
BEGIN
  INSERT INTO answer_counts (question, choice, count)
  SELECT CAST(answer.key AS INTEGER), answer.value, 1 FROM json_each(NEW.answers) AS answer WHERE true
  ON CONFLICT (question, choice) DO UPDATE SET count = count + 1;
END;
