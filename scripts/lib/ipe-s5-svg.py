"""Editable, self-contained S5 educational SVG drawing primitives."""
import math,html,unicodedata
C={'ink':'#17324d','blue':'#2563aa','muted':'#4b6174','line':'#cbd9e5','pale':'#edf5fc','white':'#ffffff','warn':'#9a4d19'}
def esc(s):return html.escape(str(s),quote=True)
def units(s):return sum(1 if unicodedata.east_asian_width(c) in 'WF' else .56 for c in s)
def lines(s,maxu):
 r=[]
 for para in str(s).split('\n'):
  line=''
  for c in para:
   if line and units(line+c)>maxu:r.append(line);line=''
   line+=c
  r.append(line)
 return r
class SVG:
 def __init__(self,f):self.f=f;self.parts=[];self.bottom=100;self.text(32,53,f['figure_title'],32,700)
 def text(self,x,y,s,size=24,weight=400,color='ink',width=None,anchor='start'):
  ls=lines(s,width/size if width else 1000)
  for i,line in enumerate(ls):self.parts.append(f'<text x="{x}" y="{y+i*(size+10)}" font-size="{size}" font-weight="{weight}" fill="{C.get(color,color)}" text-anchor="{anchor}">{esc(line)}</text>')
  self.bottom=max(self.bottom,y+len(ls)*(size+10));return len(ls)*(size+10)
 def box(self,x,y,w,h,title,body='',tone='pale',size=24):
  self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{C[tone]}" stroke="{C["line"]}" stroke-width="2"/>');self.bottom=max(self.bottom,y+h)
  th=self.text(x+20,y+37,title,size,700,width=w-40)
  if body:
   end=42+th+(len(lines(body,(w-40)/22))-1)*32+8
   assert end<=h-8, ('Text exceeds box',self.f['figure_title'],title,end,h)
   self.text(x+20,y+42+th,body,22,width=w-40)
 def arrow(self,points,label='',lx=None,ly=None,dashed=False,color='blue'):
  d='M '+' L '.join(f'{x},{y}' for x,y in points);self.parts.append(f'<path d="{d}" fill="none" stroke="{C[color]}" stroke-width="3" marker-end="url(#arrow)"'+(' stroke-dasharray="8 6"' if dashed else '')+'/>')
  self.bottom=max(self.bottom,max(p[1] for p in points))
  if label:self.text(lx if lx is not None else points[0][0]+12,ly if ly is not None else points[0][1]-12,label,20,500,color)
 def note(self,s,y=None):
  y=y or self.bottom+35;h=self.text(38,y,s,22,400,'muted',width=820);self.bottom=y+h;return self.bottom
 def row(self,y,items,h=120):
  n=len(items);gap=24;w=(836-gap*(n-1))/n
  for i,v in enumerate(items):self.box(32+i*(w+gap),y,w,h,v[0],v[1] if len(v)>1 else '')
  return y+h
 def table(self,y,headers,rows,widths=None):
  widths=widths or [836/len(headers)]*len(headers);x=32
  allrows=[headers]+rows
  for ri,row in enumerate(allrows):
   h=max(max(len(lines(v,(w-24)/22)) for v,w in zip(row,widths))*32+22,56);x=32
   for v,w in zip(row,widths):
    self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{C["ink"] if ri==0 else (C["pale"] if ri%2 else C["white"])}" stroke="{C["line"]}"/>');self.text(x+12,y+35,v,22,700 if ri==0 else 400,'white' if ri==0 else 'ink',w-24);x+=w
   y+=h
  self.bottom=max(self.bottom,y);return y
 def save(self,path):
  h=math.ceil(self.bottom+28);desc=' '.join(self.f['required_text_or_rules'])
  svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="{h}" viewBox="0 0 900 {h}" role="img" aria-labelledby="title desc"><title id="title">{esc(self.f["figure_title"])}</title><desc id="desc">{esc(desc)}</desc><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z" fill="{C["blue"]}"/></marker></defs><rect width="900" height="{h}" rx="18" fill="white"/><g font-family="Apple SD Gothic Neo, Noto Sans KR, sans-serif">'+''.join(self.parts)+'</g></svg>'
  path.write_text(svg);return h
