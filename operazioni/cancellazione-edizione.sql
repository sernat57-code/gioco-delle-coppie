-- Compilare data e UUID dell'edizione verificati nel pannello Supabase.
-- Usare l'ora italiana per stabilire la data di chiusura.
-- Alla scadenza eseguire nel SQL Editor. Prima verificare l'elenco e il conteggio.
-- La procedura riguarda il database. Rimuovere anche le copie delle schede
-- ancora sotto il controllo dell'organizzatore e verificare la scadenza dei backup.
begin;
create temporary table gdc_pulizia_config (
  chiusura date not null,
  ids uuid[] not null
) on commit drop;

-- Sostituire la data e l'array vuoto prima dell'esecuzione.
insert into gdc_pulizia_config values (date '2000-01-01', array[]::uuid[]);

do $$
declare
  chiusura_edizione date;
  candidature uuid[];
  attese integer;
  presenti integer;
begin
  select chiusura, ids into strict chiusura_edizione, candidature from gdc_pulizia_config;
  if chiusura_edizione = date '2000-01-01' or (now() at time zone 'Europe/Rome')::date < chiusura_edizione + 30 then
    raise exception 'Impostare la data effettiva di chiusura e attendere la scadenza';
  end if;
  attese := cardinality(candidature);
  if attese = 0 or attese <> (select count(distinct id) from unnest(candidature) as t(id)) then
    raise exception 'Indicare gli UUID distinti delle sole candidature di questa edizione';
  end if;
  perform id from public.concorrenti where id = any(candidature) for update;
  get diagnostics presenti = row_count;
  if presenti <> attese or exists (
    select 1 from public.concorrenti where id = any(candidature)
    and (data_iscrizione is null or (data_iscrizione at time zone 'Europe/Rome')::date > chiusura_edizione)
  ) then
    raise exception 'Almeno una candidatura manca o è successiva alla chiusura';
  end if;
  delete from public.gdc_prime_coppie_limiti
    where ambiente = 'reale' and (persona_id = any(candidature) or persona_abbinata = any(candidature));
  delete from public.gdc_consensi_limiti
    where ambiente = 'reale' and (persona_a = any(candidature) or persona_b = any(candidature));
  delete from public.concorrenti where id = any(candidature);
  if exists (select 1 from public.concorrenti where id = any(candidature)) or exists (
    select 1 from public.gdc_prime_coppie_limiti
    where ambiente = 'reale' and (persona_id = any(candidature) or persona_abbinata = any(candidature))
  ) or exists (
    select 1 from public.gdc_consensi_limiti
    where ambiente = 'reale' and (persona_a = any(candidature) or persona_b = any(candidature))
  ) then
    raise exception 'Pulizia incompleta: transazione annullata';
  end if;
end $$;
commit;
