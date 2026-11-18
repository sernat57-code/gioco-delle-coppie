import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers,
  });
}

type RecordData = Record<string, unknown>;
const record = (v: unknown): v is RecordData => v !== null && typeof v === 'object' && !Array.isArray(v);
const scale = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
const exact = (v: RecordData, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const bdsmKeys = ['fiducia','negoziazione','ritualita','intensita','flessibilita','comunicazione'];
const characterKeys = ['socievolezza','spontaneita','dialogo','autonomia'];
const practiceKeys = ['sadomasochismo','bondage','disciplina','umiliazione','dominazione_sessuale','controllo_orgasmo','esibizionismo','giochi_mentali','protocolli','quotidianita','pet_play','servizio'];
const genders = ['donna','uomo','non binario','altro','non dichiarato'];
function validate(body: unknown) {
 if (!record(body)) return null;
 const {pseudonimo,ruolo,genere,generi_preferiti,risposte,consenso_dati,maggiorenne,turnstile_token} = body;
 if (Object.hasOwn(body,'consenso_condivisione_limiti') && typeof body.consenso_condivisione_limiti !== 'boolean') return null;
 if (typeof pseudonimo !== 'string' || pseudonimo.trim().length < 2 || pseudonimo.length > 100 ||
     typeof ruolo !== 'string' || !['dominante','sottomesso','switch'].includes(ruolo) ||
     typeof genere !== 'string' || !genders.includes(genere) ||
     !Array.isArray(generi_preferiti) || generi_preferiti.length < 1 || generi_preferiti.length > genders.length ||
     new Set(generi_preferiti).size !== generi_preferiti.length ||
     !generi_preferiti.every(g => typeof g === 'string' && genders.includes(g)) ||
     consenso_dati !== true || maggiorenne !== true ||
     typeof turnstile_token !== 'string' || !turnstile_token.trim() || turnstile_token.length > 2048 ||
     !record(risposte) || !exact(risposte,['fascia_eta','bdsm','carattere','mappa_desideri']) ||
     !['18-30','31-50','oltre-50'].includes(String(risposte.fascia_eta))) return null;
 const bdsm = risposte.bdsm, carattere = risposte.carattere, mappa = risposte.mappa_desideri;
 if (!record(bdsm) || !exact(bdsm,bdsmKeys) || !bdsmKeys.every(k=>scale(bdsm[k])) ||
     !record(carattere) || !exact(carattere,characterKeys) || !characterKeys.every(k=>scale(carattere[k])) ||
     !record(mappa) || !exact(mappa,practiceKeys)) return null;
 const cleanMap: RecordData = {};
 for (const k of practiceKeys) {
  const p = mappa[k];
  if (!record(p) || Object.keys(p).some(k=>!['interesse','intensita','limite','limite_invalicabile'].includes(k)) ||
      !Object.hasOwn(p,'interesse') || !Object.hasOwn(p,'intensita') ||
      !['desidero','curioso','non_interessa','limite'].includes(String(p.interesse)) ||
      (Object.hasOwn(p,'limite') && typeof p.limite !== 'boolean') ||
      (Object.hasOwn(p,'limite_invalicabile') && typeof p.limite_invalicabile !== 'boolean')) return null;
  const limit = p.interesse === 'limite' || p.limite === true || p.limite_invalicabile === true;
  // Un limite e un desiderio sulla stessa pratica sono risposte contraddittorie.
  if (limit && !['limite','non_interessa'].includes(String(p.interesse))) return null;
  if ((limit || p.interesse === 'non_interessa') ? p.intensita !== null : !scale(p.intensita)) return null;
  cleanMap[k] = {interesse: limit ? 'limite' : p.interesse, intensita:p.intensita};
 }
 return {
  pseudonimo:pseudonimo.trim(),ruolo,genere,generi_preferiti,
  consenso_dati:true,
  risposte:{fascia_eta:risposte.fascia_eta,bdsm:{...bdsm},carattere:{...carattere},mappa_desideri:cleanMap,maggiorenne:true,
   condivisione_limiti:{
    autorizzo:body.consenso_condivisione_limiti===true,
    versione:'questionario-limiti-v1',
    registrato_il:new Date().toISOString(),
    limiti_snapshot:practiceKeys.filter(k=>(cleanMap[k] as RecordData).interesse==='limite').sort()
   }
  },
  turnstile_token
 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return reply("Metodo non consentito", 405);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");

    if (!url || !key || !turnstileSecret) {
      return reply("Configurazione del server incompleta", 500);
    }

    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 65536) return reply("Richiesta troppo grande", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return reply("JSON non valido", 400); }
    const candidatura = validate(body);
    if (!candidatura) return reply("Questionario incompleto o non valido. Controlli le risposte e le conferme richieste.", 400);
    const { turnstile_token, ...dati } = candidatura;

    const verification = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: turnstileSecret,
          response: turnstile_token,
        }),
      }
    );

    if (!verification.ok) {
      return reply("Verifica antispam non disponibile", 503);
    }

    const result = await verification.json();

    if (result.success !== true) {
      return reply("Verifica antispam non superata", 403);
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false },
    });

    const { error } = await supabase.from("concorrenti").insert(dati);

    if (error) {
      console.error("Errore inserimento candidatura:", error.code);
      return reply("Impossibile registrare la candidatura", 500);
    }

    return reply("Candidatura registrata correttamente", 201);
  } catch {
    return reply("Servizio temporaneamente non disponibile. Riprovi più tardi.", 503);
  }
});
