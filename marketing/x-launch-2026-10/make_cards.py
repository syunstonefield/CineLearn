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

T=5
card(1,T,'観る前に、\n3分だけ予習。','今夜観る話の重要単語だけをリストに。',[('作品と話数を選ぶだけ','あとは自動で単語リストに'),('基礎単語は自動でスキップ','覚えるべき語だけに絞る')],f'{OUT}/01-vocab.png',shot='01-vocab-list.png')
card(2,T,'セリフが、\nそのまま例文。','「あのシーンのあの一言」で覚える。',[('出典つき（作品・話数）','どこで出会った語か分かる'),('3段階の採点で間隔反復','忘れる前に、また出てくる')],f'{OUT}/02-review.png',shot='02-review-card.png')
card(3,T,'今日の復習は、\n20語だけ。','忘れる前のタイミングで通知。',[('学習した日がカレンダーに','続いている実感が残る'),('覚えた・マスターを集計','積み上がりが数字で見える')],f'{OUT}/03-home.png',shot='03-home.png')
card(4,T,'出会った語が、\n積み上がる。','覚えた・マスターがひと目で。',[('出会った語をすべて記録','棚から外した作品の語も'),('3週間後も言えたらマスター','本当に定着した語だけ')],f'{OUT}/04-progress.png',shot='04-progress.png')
card(5,T,'字幕の中で、\n再会する。','PC の Chrome なら拡張機能も（無料）。',[('字幕の単語をクリックで保存','動画を止めなくていい'),('保存した語・覚えた語に印','別の作品で出会うと点線が付く')],f'{OUT}/05-extension.png',panel_src=('extension-landscape.png',(400,735,1600,1145)))
