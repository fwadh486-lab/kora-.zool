const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const push=fs.readFileSync(require.resolve('../push-client-v5.js'),'utf8');
const notify=fs.readFileSync(require.resolve('../notifications-custom-v1.js'),'utf8');
test('notification scope, individual teams and competition intersection are editable',()=>{
 for(const id of ['notifyCustomCard','notifyLeagueList','notifyTeamInput','notifyTeamSelected','notifyCustomSummary','notifyFavoriteMatches'])assert.ok(html.includes('id="'+id+'"'));
 for(const choice of ['selected','all','any','both'])assert.ok(html.includes('value="'+choice+'"'));
 for(const code of ['afcelite','cl','cafcl','sd','sa'])assert.ok(notify.includes("'"+code+"'"));
 assert.match(push,/leagues:window\.KoraNotifications/);
 assert.match(push,/selectionRule:window\.KoraNotifications/);assert.match(push,/favoriteMatchesEnabled:window\.KoraNotifications/);
 assert.match(notify,/korazol:preferences-changed/);
});
test('Firebase sign-in interface and account restore controls exist',()=>{
 for(const id of ['koraAccountForm','koraAccountEmail','koraAccountPassword','koraAccountSignup','koraAccountSync','koraAccountRestore','koraAccountSignout'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/account-v1\.js/);
 assert.match(html,/notifications-custom-v1\.js/);
});

test('account writes pending device changes synchronously before upload and restores them safely',()=>{const account=fs.readFileSync(require.resolve('../account-v1.js'),'utf8');assert.match(account,/korazol_account_pending_v1_/);assert.match(account,/store\(pendingKey\(current\.uid\),JSON\.stringify\(snapshot\(\)\)\)/);assert.match(account,/await account\('PUT',local\)/);assert.match(account,/if\(read\(pendingKey\(uid\)\)===fingerprint\)/);});
