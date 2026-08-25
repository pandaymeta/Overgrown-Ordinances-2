from PIL import Image, ImageChops
from pathlib import Path
root=Path(r"C:\Users\Reyjhon Entenia\Documents\Overgrown\Ordinances")
base=Image.open(root/'FireHydrant.png').convert('RGBA')
targets={n:Image.open(root/'BenchStandardCardImages'/n).convert('RGBA') for n in ['FireHydrant_RuntimeFront.png','FireHydrant_RuntimeBack.png']}
ops={'I':lambda x:x,'L':lambda x:x.transpose(Image.Transpose.FLIP_LEFT_RIGHT),'T':lambda x:x.transpose(Image.Transpose.FLIP_TOP_BOTTOM),'R90':lambda x:x.transpose(Image.Transpose.ROTATE_90),'R180':lambda x:x.transpose(Image.Transpose.ROTATE_180),'R270':lambda x:x.transpose(Image.Transpose.ROTATE_270)}
for a,fa in ops.items():
 for b,fb in ops.items():
  im=fb(fa(base))
  for name,t in targets.items():
   if im.size==t.size and not ImageChops.difference(im,t).getbbox(): print(name,a,b)
