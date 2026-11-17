-- Wrong passwords by client address: after too many in a short window that address is refused
-- for a while (lib/login-guard.ts). Rows older than a day are deleted as new ones come in.
create table login_attempts (
  ip text not null,
  at timestamptz not null default now()
);
create index login_attempts_ip on login_attempts (ip, at desc);
