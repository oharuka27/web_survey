CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  answers TEXT NOT NULL CHECK (json_valid(answers) AND json_array_length(answers) = 4),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
