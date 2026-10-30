# X 告知用の縦カード（1080×1350・App Store 風）。スクショ＝実画面、文言は docs/x-launch-post.md 準拠。
# 2026-10-11 v2: 背景をぼかし無しのフラット＋幾何図形に、フォントをヒラギノ丸ゴ ProN（疑似ボールド）に。
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.abspath(HERE+'/../..'); SRC=HERE+'/src'; OUT=HERE+'/cards'
W,H=1080,1350
CREAM=(251,247,239); GOLD=(184,146,58); GOLD_DARK=(140,105,35); GOLD_LIGHT=(245,233,208); AMBER=(236,211,160); SAND=(246,239,224)
TEXT=(26,26,26); MUTED=(100,96,88); WHITE=(255,255,255)
FP='/System/Library/Fonts/ヒラギノ丸ゴ ProN W4.ttc'
def F(size): return ImageFont.truetype(FP, size)
F_HEAD=F(58); F_SUB=F(26); F_CHIP=F(29); F_CHIP_S=F(21); F_BADGE=F(22); F_TAG=F(26)
SW_HEAD=2; SW_CHIP=1   # 疑似ボールドの縁取り幅

def rounded(im, r):
    m=Image.new('L', im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0,0,im.width-1,im.height-1], r, fill=255)
    o=im.convert('RGBA'); o.putalpha(m); return o

def shadow(canvas, box, r, blur=30, alpha=80, dx=0, dy=18):
    sh=Image.new('RGBA',canvas.size,(0,0,0,0)); d=ImageDraw.Draw(sh)
    d.rounded_rectangle([box[0]+dx,box[1]+dy,box[2]+dx,box[3]+dy], r, fill=(90,70,30,alpha))
    sh=sh.filter(ImageFilter.GaussianBlur(blur)); canvas.paste(sh,(0,0),sh)

def background():
    # フラットなクリーム地＋輪郭のはっきりした円（ぼかし無し）
    c=Image.new('RGB',(W,H),CREAM); d=ImageDraw.Draw(c)
    d.ellipse([-260,-300,420,380], fill=GOLD_LIGHT)            # 左上の大きな円
    d.ellipse([760,-140,1180,280], fill=SAND)                  # 右上の淡い円
    d.ellipse([640,900,1320,1580], fill=AMBER)                 # 右下の円（端末の背後）
    d.ellipse([-120,980,260,1360], outline=GOLD_LIGHT, width=26)  # 左下のリング
    return c

def white_card(canvas, box, r=30):
    shadow(canvas, box, r, blur=24, alpha=40, dy=10)
    ImageDraw.Draw(canvas).rounded_rectangle(box, r, fill=WHITE)

def phone(canvas, shot_path, x, y, width):
    shot=Image.open(shot_path).convert('RGB')
    s=width/shot.width; shot=shot.resize((width, round(shot.height*s)), Image.LANCZOS)
    bez=18; fw,fh=width+bez*2, shot.height+bez*2
    shadow(canvas,[x,y,x+fw,y+fh],64,blur=36,alpha=110,dy=26)
    frame=Image.new('RGBA',(fw,fh),(0,0,0,0)); ImageDraw.Draw(frame).rounded_rectangle([0,0,fw-1,fh-1],64,fill=(24,24,26,255))
    canvas.paste(frame,(x,y),frame); sr=rounded(shot,48); canvas.paste(sr,(x+bez,y+bez),sr)

def panel(canvas, img_path, crop, x, y, width):
    im=Image.open(img_path).convert('RGB').crop(crop); s=width/im.width; im=im.resize((width, round(im.height*s)), Image.LANCZOS)
    pad=22; pw,ph=width+pad*2, im.height+pad*2
    shadow(canvas,[x,y,x+pw,y+ph],40,blur=36,alpha=110,dy=26)
    fr=Image.new('RGBA',(pw,ph),(0,0,0,0)); ImageDraw.Draw(fr).rounded_rectangle([0,0,pw-1,ph-1],40,fill=(16,16,18,255))
    canvas.paste(fr,(x,y),fr); canvas.paste(im,(x+pad,y+pad))

def chip(canvas, x, y, w, title, sub):
    h=118; white_card(canvas,[x,y,x+w,y+h],26); d=ImageDraw.Draw(canvas)
    d.text((x+28,y+20),title,font=F_CHIP,fill=GOLD_DARK,stroke_width=SW_CHIP,stroke_fill=GOLD_DARK)
    d.text((x+28,y+68),sub,font=F_CHIP_S,fill=MUTED)

def card(n, total, head, sub, chips, out, shot=None, panel_src=None):
    c=background(); d=ImageDraw.Draw(c)
    badge=f'{n:02d} / {total:02d}'; bw=d.textlength(badge,font=F_BADGE)+40
    white_card(c,[W-60-bw,56,W-60,56+44],22); d=ImageDraw.Draw(c); d.text((W-60-bw+20,56+9),badge,font=F_BADGE,fill=MUTED)
    hb=d.multiline_textbbox((0,0),head,font=F_HEAD,spacing=14,stroke_width=SW_HEAD); sb=d.textbbox((0,0),sub,font=F_SUB)
    cw=max(hb[2],sb[2])+84; ch=hb[3]+sb[3]+100
    white_card(c,[60,100,60+cw,100+ch],30); d=ImageDraw.Draw(c)
    d.multiline_text((102,138),head,font=F_HEAD,fill=TEXT,spacing=14,stroke_width=SW_HEAD,stroke_fill=TEXT)
    d.text((102,138+hb[3]+24),sub,font=F_SUB,fill=MUTED)
    cy=440 if shot else 100+ch+40
    for t,s in chips:
        chip(c,60,cy,460,t,s); cy+=142
    if shot: phone(c, f'{SRC}/{shot}', 560, 420, 470)
    if panel_src: panel(c, f'{SRC}/{panel_src[0]}', panel_src[1], 60, cy+24, 916)
    d=ImageDraw.Draw(c); d.text((60,1226),'観たいドラマが、教材になる。',font=F_TAG,fill=MUTED)
    logo=Image.open(ROOT+'/icons/logo.png').convert('RGBA'); lh=34; logo=logo.resize((round(logo.width*lh/logo.height),lh),Image.LANCZOS)
    c.paste(logo,(60,1268),logo)
    c.save(out,optimize=True); print(out)

def make_x_cards():
    T=5
    card(1,T,'観る前に、\n3分だけ予習。','今夜観る話の重要単語だけをリストに。',[('作品と話数を選ぶだけ','あとは自動で単語リストに'),('基礎単語は自動でスキップ','覚えるべき語だけに絞る')],f'{OUT}/01-vocab.png',shot='01-vocab-list.png')
    card(2,T,'セリフが、\nそのまま例文。','「あのシーンのあの一言」で覚える。',[('出典つき（作品・話数）','どこで出会った語か分かる'),('3段階の採点で間隔反復','忘れる前に、また出てくる')],f'{OUT}/02-review.png',shot='02-review-card.png')
    card(3,T,'今日の復習は、\n20語だけ。','忘れる前のタイミングで通知。',[('学習した日がカレンダーに','続いている実感が残る'),('覚えた・マスターを集計','積み上がりが数字で見える')],f'{OUT}/03-home.png',shot='03-home.png')
    card(4,T,'出会った語が、\n積み上がる。','覚えた・マスターがひと目で。',[('出会った語をすべて記録','棚から外した作品の語も'),('3週間後も言えたらマスター','本当に定着した語だけ')],f'{OUT}/04-progress.png',shot='04-progress.png')
    card(5,T,'字幕の中で、\n再会する。','PC の Chrome なら拡張機能も（無料）。',[('字幕の単語をクリックで保存','動画を止めなくていい'),('保存した語・覚えた語に印','別の作品で出会うと点線が付く')],f'{OUT}/05-extension.png',panel_src=('extension-landscape.png',(400,735,1600,1145)))


# ───────────────────────────────────────────────────────────────
# Chrome Web Store 申請用スクリーンショット（1280×800・横長・キャプション焼き込み）2026-10-31
# 元の縦カードと同じ部品（白カード・チップ・端末フレーム・黒パネル）を横長に組み直す。
# A = docs/chrome-web-store-listing.md §9.4 の構成、B = X 告知画像の構成（オーナー判断用に両案を出力）。
# 使い方: python3 make_cards.py cws   → ../cws-screenshots-v1.2.10/{A-listing,B-launch}/0N-*.png
# 注意: ホーム画面は TMDB ポスターが写るので下端を切って使う（crop_h）。配信サービスのロゴ・映像は入れない。
LW,LH=1280,800
CWS_OUT=os.path.abspath(HERE+'/../cws-screenshots-v1.2.10')
L_HEAD=F(50); L_SUB=F(24); L_TAG=F(22)

def l_background():
    c=Image.new('RGB',(LW,LH),CREAM); d=ImageDraw.Draw(c)
    d.ellipse([-220,-260,360,320], fill=GOLD_LIGHT)
    d.ellipse([1040,-160,1420,220], fill=SAND)
    d.ellipse([820,520,1420,1120], fill=AMBER)
    d.ellipse([-100,560,220,880], outline=GOLD_LIGHT, width=22)
    return c

def l_phone(canvas, shot_path, x, y, width, crop_h=None):
    shot=Image.open(shot_path).convert('RGB')
    if crop_h: shot=shot.crop((0,0,shot.width,crop_h))
    s=width/shot.width; shot=shot.resize((width, round(shot.height*s)), Image.LANCZOS)
    bez=16; fw,fh=width+bez*2, shot.height+bez*2
    shadow(canvas,[x,y,x+fw,y+fh],56,blur=32,alpha=110,dy=22)
    frame=Image.new('RGBA',(fw,fh),(0,0,0,0)); ImageDraw.Draw(frame).rounded_rectangle([0,0,fw-1,fh-1],56,fill=(24,24,26,255))
    canvas.paste(frame,(x,y),frame); sr=rounded(shot,42); canvas.paste(sr,(x+bez,y+bez),sr)

def l_panel(canvas, img_path, crop, x, y, width, light=False):
    im=Image.open(img_path).convert('RGB').crop(crop); s=width/im.width; im=im.resize((width, round(im.height*s)), Image.LANCZOS)
    pad=10 if light else 20; pw,ph=width+pad*2, im.height+pad*2
    shadow(canvas,[x,y,x+pw,y+ph],34,blur=32,alpha=90 if light else 110,dy=22)
    fill=(255,255,255,255) if light else (16,16,18,255)
    fr=Image.new('RGBA',(pw,ph),(0,0,0,0)); ImageDraw.Draw(fr).rounded_rectangle([0,0,pw-1,ph-1],34,fill=fill)
    canvas.paste(fr,(x,y),fr); imr=rounded(im,26 if light else 18); canvas.paste(imr,(x+pad,y+pad),imr)

def l_chip(canvas, x, y, w, title, sub):
    h=112 if sub else 76; white_card(canvas,[x,y,x+w,y+h],24); d=ImageDraw.Draw(canvas)
    d.text((x+26,y+18),title,font=F_CHIP,fill=GOLD_DARK,stroke_width=SW_CHIP,stroke_fill=GOLD_DARK)
    if sub: d.text((x+26,y+64),sub,font=F_CHIP_S,fill=MUTED)
    return h

def l_header(canvas, head, sub, x=60, y=56):
    d=ImageDraw.Draw(canvas)
    hb=d.multiline_textbbox((0,0),head,font=L_HEAD,spacing=12,stroke_width=SW_HEAD); sb=d.textbbox((0,0),sub,font=L_SUB) if sub else (0,0,0,0)
    cw=max(hb[2],sb[2])+80; ch=hb[3]+(sb[3]+22 if sub else 0)+76
    white_card(canvas,[x,y,x+cw,y+ch],28); d=ImageDraw.Draw(canvas)
    d.multiline_text((x+40,y+34),head,font=L_HEAD,fill=TEXT,spacing=12,stroke_width=SW_HEAD,stroke_fill=TEXT)
    if sub: d.text((x+40,y+34+hb[3]+22),sub,font=L_SUB,fill=MUTED)
    return (x,y,x+cw,y+ch)

def l_footer(canvas, x=60, y=712, inline=False):
    d=ImageDraw.Draw(canvas); d.text((x,y),'観たいドラマが、教材になる。',font=L_TAG,fill=MUTED)
    logo=Image.open(ROOT+'/icons/logo.png').convert('RGBA'); lh=30 if not inline else 26; logo=logo.resize((round(logo.width*lh/logo.height),lh),Image.LANCZOS)
    if inline: canvas.paste(logo,(x+round(d.textlength('観たいドラマが、教材になる。',font=L_TAG))+22,y+1),logo)
    else: canvas.paste(logo,(x,y+40),logo)

def shot_card(head, sub, chips, out, shot, phone_y=40, phone_w=400, crop_h=None):
    """左: 見出し＋チップ＋タグライン／右: 端末フレーム（下にはみ出す）"""
    c=l_background(); l_header(c,head,sub)
    cy=300
    for t,s in chips: cy+=l_chip(c,60,cy,500,t,s)+22
    l_phone(c, f'{SRC}/{shot}', LW-60-phone_w-32, phone_y, phone_w, crop_h=crop_h)
    l_footer(c); c.save(out,optimize=True); print(out)

def panel_card(head, sub, chips, out, panel_src, crop, panel_y=350, panel_w=1160, light=False, chips_x=None, chip_w=460, footer=True):
    """上: 見出し（左）＋チップ（右）／下: 横長パネル（字幕バーや単語カードの拡大）"""
    c=l_background(); hx0,hy0,hx1,hy1=l_header(c,head,sub)
    cx=chips_x if chips_x is not None else max(hx1+28, LW-60-chip_w); cy=56
    for t,s in chips: cy+=l_chip(c,cx,cy,LW-60-cx,t,s)+18
    l_panel(c, f'{SRC}/{panel_src}', crop, (LW-panel_w)//2-(10 if light else 20), panel_y, panel_w, light=light)
    if footer: l_footer(c, y=LH-54, inline=True)
    c.save(out,optimize=True); print(out)

def make_cws():
    A=f'{CWS_OUT}/A-listing'; B=f'{CWS_OUT}/B-launch'
    for d in (A,B): os.makedirs(d, exist_ok=True)
    # ── A: §9.4 の構成（単語カード→字幕クリック→予習→字幕マーカー→復習）
    # A1 単語カード: 単語リスト画面の展開カード（セリフ例文＋作品名・話数）を拡大
    c=l_background(); l_header(c,'観た場面のセリフが、\nそのまま例文になる単語帳','作品名・話数つき。「あのシーンのあの一言」で覚える。')
    cy=310
    for t,s in [('実際のセリフが例文に','作品名・話数も一緒に残る'),('日本語の意味と訳文つき','発音も聞ける')]: cy+=l_chip(c,60,cy,470,t,s)+22
    l_panel(c, f'{SRC}/01-vocab-list.png', (36,715,884,1275), 590, 300, 620, light=True)
    l_footer(c); c.save(f'{A}/01-word-card.png',optimize=True); print(f'{A}/01-word-card.png')
    # A2 字幕クリック→意味→保存（UI主役・映像なし）
    panel_card('字幕の単語を、\nクリックするだけで保存','動画を止めなくていい。意味はマウスを乗せるだけ。',
        [('日本語の意味がすぐ出る','同梱の英和辞書・通信なし'),('ドラッグすれば句も保存','保存した語は単語帳に同期')],
        f'{A}/02-subtitle-click-save.png','extension-landscape.png',(400,735,1600,1145),panel_y=322,panel_w=1080)
    # A3 予習画面
    shot_card('観る前に3分。\nこの話で覚えるべき語だけ','作品と話数を選ぶだけで、重要語のリストに。',
        [('基礎単語は自動でスキップ','覚えるべき語だけに絞る'),('予習・復習は学習アプリで','拡張で保存した語と同期')],
        f'{A}/03-prep-list.png','01-vocab-list.png',phone_y=40)
    # A4 字幕マーカー（クリーム色＋点線）
    panel_card('他の作品で覚えた単語に、\n字幕の中で再会','控えめな印。設定でオフにもできる。',
        [('淡いクリーム色の印','保存した語・この話の予習語'),('細い点線の印','他の作品で出会った語。出所も分かる')],
        f'{A}/04-subtitle-markers.png','extension-landscape.png',(420,978,1580,1142),panel_y=420,panel_w=1160,chip_w=520)
    # A5 復習カード（3段階採点）
    shot_card('忘れる前のタイミングで\n復習を提案','間隔反復（SM-2）。3段階で採点するだけ。',
        [('知ってた／うろ覚え／知らなかった','採点で次に出る間隔が変わる'),('例文はあのセリフ','出典つきで文脈ごと思い出す')],
        f'{A}/05-review-card.png','02-review-card.png',phone_y=40)
    # ── B: X 告知画像の構成（予習→例文→ホーム→歩み→拡張）。見出しは告知の文言、チップは §9.3 の表現に寄せる
    shot_card('観る前に、\n3分だけ予習。','今夜観る話の重要単語だけをリストに。',
        [('作品と話数を選ぶだけ','あとは自動で単語リストに'),('基礎単語は自動でスキップ','覚えるべき語だけに絞る')],
        f'{B}/01-prep.png','01-vocab-list.png',phone_y=40)
    shot_card('セリフが、\nそのまま例文。','「あのシーンのあの一言」で覚える。',
        [('出典つき（作品・話数）','どこで出会った語か分かる'),('3段階の採点で間隔反復','忘れる前に、また出てくる')],
        f'{B}/02-example.png','02-review-card.png',phone_y=40)
    shot_card('今日の復習は、\n20語だけ。','忘れる前のタイミングで通知。',
        [('学習した日がカレンダーに','続いている実感が残る'),('覚えた・マスターを集計','積み上がりが数字で見える')],
        f'{B}/03-home.png','03-home.png',phone_y=232,phone_w=460,crop_h=1180)   # ポスターが写る「続きから学習」より上で切る
    shot_card('出会った語が、\n積み上がる。','覚えた・マスターがひと目で。',
        [('出会った語をすべて記録','棚から外した作品の語も'),('3週間後も言えたらマスター','本当に定着した語だけ')],
        f'{B}/04-progress.png','04-progress.png',phone_y=40)
    panel_card('字幕の中で、\n再会する。','PC の Chrome なら拡張機能も（無料）。',
        [('字幕の単語をクリックで保存','動画を止めなくていい'),('保存した語・覚えた語に印','別の作品で出会うと点線が付く')],
        f'{B}/05-extension.png','extension-landscape.png',(400,735,1600,1145),panel_y=322,panel_w=1080,chips_x=700,chip_w=520)

if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='cws': make_cws()
    else: make_x_cards()
