/**
 * CineLearn — TOEIC レベル別除外語リスト
 *
 * NGSL（New General Service List）の頻度データを TOEIC スコア帯に対応させた
 * コンパクトな除外語セット。単語生成時にこのレベル以下の語を Claude に渡さない。
 *
 * Tier 定義：
 *   tier0  : TOEIC ≤ 400（A2 以下）— 超基礎語 ~500語
 *   tier400: TOEIC ≤ 600（B1）    — 日常語  ~700語
 *   tier600: TOEIC ≤ 800（B2）    — 中上級語 ~600語
 *
 * 使い方：
 *   const excluded = getExcludeSet(toeicScore);  // 現スコア以下の語集合
 *   const hint     = getExcludeHint(toeicScore);  // プロンプト用ヒント文
 */

// ─── Tier 0: TOEIC ≤400 の超基礎語（助動詞・機能語・最頻出語） ───────────────
const TIER0 = [
  // 助動詞・be動詞
  'be','is','are','was','were','am','been','being',
  'have','has','had','having',
  'do','does','did','done',
  'will','would','can','could','shall','should','may','might','must','need',
  // 最頻出動詞
  'go','come','get','make','take','give','say','tell','ask','know',
  'think','feel','see','look','want','use','find','let','put','keep',
  'try','leave','call','seem','show','hear','play','run','move','live',
  'hold','bring','write','sit','stand','lose','pay','meet','set','learn',
  'change','lead','read','spend','grow','open','walk','buy','turn',
  'start','stop','fall','build','send','wait','help','need','work',
  'speak','talk','eat','drink','sleep','wake','sit','walk','run',
  'return','stay','remain','begin','continue','allow','add','follow',
  'pass','break','win','enter','watch','remember','happen','create',
  // 最頻出名詞
  'time','year','people','way','day','man','woman','child','thing',
  'world','life','hand','part','place','case','week','company',
  'system','program','question','work','government','number','night',
  'point','home','water','room','mother','area','money','story','fact',
  'month','lot','right','study','book','eye','job','word','business',
  'issue','side','kind','head','house','service','friend','father',
  'power','hour','game','line','end','city','community','name','team',
  'minute','street','body','information','family','school','country',
  'state','group','example','face','public','order','type','war',
  'fire','south','north','east','west','center','level','position',
  // 最頻出形容詞・副詞
  'good','new','old','great','big','large','small','high','low',
  'long','short','different','own','last','next','early','young',
  'important','few','public','private','real','open','best','free',
  'possible','hard','easy','full','true','false','local','national',
  'little','right','wrong','light','dark','hot','cold','fast','slow',
  'happy','sad','nice','bad','fine','sure','only','just','very',
  'too','also','quite','really','even','still','already','again',
  'always','often','never','sometimes','maybe','probably','perhaps',
  'here','there','now','then','today','yesterday','tomorrow','soon',
  'often','once','twice','well','away','back','around','off','out',
  'up','down','in','on','over','under','through','before','after',
  'between','about','around','above','below','behind','near','far',
  // 冠詞・代名詞・前置詞・接続詞
  'a','an','the','this','that','these','those',
  'i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','mine','yours',
  'who','what','which','where','when','why','how',
  'and','or','but','so','yet','if','because','when','while','though',
  'although','unless','until','since','as','than',
  'of','to','in','for','on','with','at','by','from','up','about',
  'into','through','during','before','after','above','below','between',
  // 数・頻度・程度
  'one','two','three','four','five','six','seven','eight','nine','ten',
  'first','second','third','last','next','both','each','every','all',
  'some','any','many','much','more','most','less','few','other','same',
  'no','not','nor','neither','either','both','such','enough',
];

// ─── Tier 400: TOEIC ≤600 の日常語（日常会話・基礎ビジネス） ──────────────────
const TIER400 = [
  // 日常動詞
  'accept','achieve','affect','agree','appear','apply','arrange',
  'attend','avoid','carry','catch','check','choose','close','collect',
  'complete','contact','control','cover','decide','describe','develop',
  'discuss','drop','enable','enjoy','establish','expect','experience',
  'explain','express','focus','handle','identify','improve','include',
  'increase','introduce','involve','join','manage','mention','offer',
  'operate','perform','prepare','produce','provide','receive','reduce',
  'refer','replace','represent','require','respond','review','select',
  'solve','sort','spend','suggest','support','survive','test','treat',
  'visit','advance','attempt','attract','balance','compare','concern',
  'conduct','confirm','contain','cost','count','create','deal','deliver',
  'design','determine','discover','discuss','display','distribute',
  'draw','drive','earn','ensure','fill','fix','follow','form','gather',
  'generate','give','guess','ignore','imagine','implement','inform',
  'install','keep','lead','lift','limit','listen','maintain','measure',
  'notice','obtain','occur','organize','own','participate','place',
  'plan','point','post','predict','press','print','process','protect',
  'publish','pull','push','raise','reach','realize','record','reflect',
  'relate','release','remove','repeat','report','save','schedule',
  'search','share','show','store','submit','take','transfer','update',
  'upload','use','view','write','access','add','address','adjust',
  'announce','apply','approve','assign','associate','assume','attach',
  // 日常名詞
  'account','activity','address','agreement','amount','analysis',
  'application','approach','article','aspect','attention','audience',
  'background','behavior','benefit','budget','building','capacity',
  'category','challenge','change','channel','choice','client',
  'comment','communication','condition','conference','connection',
  'content','contract','conversation','culture','customer','data',
  'database','date','decision','department','design','detail',
  'development','difference','direction','document','education',
  'effect','effort','email','employee','energy','environment',
  'equipment','event','evidence','experience','feature','feedback',
  'field','figure','form','format','function','goal','guide',
  'impact','industry','input','interview','knowledge','language',
  'list','location','market','material','meeting','message','method',
  'model','network','notice','option','output','overview','paper',
  'partner','performance','period','plan','platform','price','problem',
  'process','product','profile','project','purpose','quality',
  'range','rate','reason','relationship','report','research','resource',
  'result','role','rule','sample','section','session','situation',
  'size','skill','software','solution','source','space','speed',
  'standard','status','step','structure','subject','task','technology',
  'term','theme','tool','topic','training','type','value','version',
  'view','website','format','opportunity','pressure','production',
  'profit','property','response','revenue','risk','safety','sales',
  'security','society','software','strategy','success','supply',
  'survey','target','team','total','trade','traffic','trend',
  // 日常形容詞
  'able','active','additional','available','basic','certain','clear',
  'common','complex','complete','correct','current','direct','effective',
  'efficient','electronic','entire','equal','essential','exact','final',
  'financial','formal','general','global','human','independent',
  'individual','initial','international','large','legal','main',
  'major','modern','natural','necessary','negative','normal','online',
  'original','overall','personal','physical','positive','potential',
  'previous','primary','professional','quick','recent','regular',
  'relevant','required','responsible','serious','significant','simple',
  'single','special','specific','standard','successful','technical',
  'total','traditional','typical','unique','useful','various','virtual',
];

// ─── Tier 600: TOEIC ≤800 の中上級語（ビジネス・学術） ───────────────────────
const TIER600 = [
  // ビジネス動詞
  'accelerate','accommodate','accumulate','acquire','activate','allocate',
  'analyze','anticipate','authorize','calculate','collaborate','compile',
  'comply','coordinate','correlate','customize','delegate','demonstrate',
  'depreciate','differentiate','eliminate','evaluate','expand','facilitate',
  'formulate','generate','implement','incorporate','integrate','investigate',
  'maximize','minimize','monitor','motivate','negotiate','optimize',
  'outsource','prioritize','quantify','reconcile','restructure','retain',
  'standardize','streamline','supplement','terminate','utilize','validate',
  // ビジネス名詞
  'acquisition','agenda','allocation','amendment','analysis','assets',
  'authorization','benchmark','compensation','compliance','component',
  'consolidation','constraint','consultation','consumer','contingency',
  'contractor','contribution','corporation','criteria','currency',
  'deadline','deficit','delegation','depreciation','disclosure',
  'disposal','distribution','diversification','dividend','documentation',
  'efficiency','endorsement','enforcement','enterprise','entrepreneur',
  'equity','evaluation','expenditure','expertise','facility','forecast',
  'foundation','framework','headquarters','hierarchy','incentive',
  'infrastructure','initiative','innovation','inspection','integration',
  'inventory','investment','legislation','liability','logistics',
  'maintenance','margin','merger','methodology','milestone','momentum',
  'objection','obligation','outsourcing','overhead','perspective',
  'portfolio','productivity','proficiency','projection','provision',
  'qualification','regulation','reimbursement','representation',
  'revenue','retention','shareholder','specification','stakeholder',
  'subsidiary','sustainability','transaction','transparency','turnover',
  'utilization','valuation','variance','verification','warranty',
];

// ─── 公開 API ──────────────────────────────────────────────────────────────────

/**
 * 指定 TOEIC スコア以下の語を全て含むセットを返す
 * @param {number} score 現在の TOEIC スコア
 * @returns {Set<string>}
 */
function getExcludeSet(score) {
  const set = new Set(TIER0.map(w => w.toLowerCase()));
  if (score >= 400) TIER400.forEach(w => set.add(w.toLowerCase()));
  if (score >= 600) TIER600.forEach(w => set.add(w.toLowerCase()));
  return set;
}

/**
 * Claude プロンプト用の除外ヒント文を生成する
 * @param {number} currentScore 現在の TOEIC スコア
 * @returns {string}
 */
function getExcludeHint(currentScore) {
  if (!currentScore || currentScore < 100) return '';

  const descriptions = {
    400: 'A2レベル（中学英語レベル）の超基礎語・機能語・最頻出動詞名詞',
    600: 'B1レベル（日常会話・基礎ビジネス）の一般語を含む400点以下の全語彙',
    800: 'B2レベル（中上級ビジネス・学術）の一般語を含む600点以下の全語彙',
  };

  let desc = descriptions[400];
  if (currentScore >= 600) desc = descriptions[600];
  if (currentScore >= 800) desc = descriptions[800];

  return `\n【除外条件】現在レベル（TOEIC約${currentScore}点）の学習者が既習の${desc}は選ばないでください。それより難しく、このエピソードの文脈で実際に重要な単語のみを選んでください。`;
}

export { getExcludeSet, getExcludeHint };
