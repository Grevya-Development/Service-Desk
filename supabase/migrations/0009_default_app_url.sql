-- 0009: default the desk address to the production URL when it hasn't been set yet.
-- (Admins can change it any time in Administration → Settings; local seeds override it.)
update servicedesk.settings set value = to_jsonb('https://grevyaservicedesk.vercel.app'::text), updated_at = now()
 where key = 'app_url' and coalesce(value #>> '{}', '') = '';
