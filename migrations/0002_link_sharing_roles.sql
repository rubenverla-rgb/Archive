-- Role-based, reusable collection sharing links.
-- Existing members and invitations retain editor access for backwards compatibility.
ALTER TABLE members ADD COLUMN role TEXT NOT NULL DEFAULT 'editor';
ALTER TABLE invites ADD COLUMN role TEXT NOT NULL DEFAULT 'editor';
