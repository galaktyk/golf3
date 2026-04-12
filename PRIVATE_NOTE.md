https://help.opengolfsim.com/desktop/apis/shot-data/




--
add spin rpm in swing preview

invert horizontal axis


---

putt and green line why physics break


---



add aim line preview
---



---

wind

---

course collision texture tag





change to webrtc with qrcode for signaling
use qr as set forward





---
add new widget for practice swing preview

in the widget will have a vertical bar fill fill detected head speed 
this bar will calibrated adjust to aiming preview head
the bar top at 80% is the  aiming preview head speed m/s (show this number on the side of the bar)
bottom is 0% , top is 120%

so use  flow is like
1. aim for the spot
2. check the require head speed for that aiming spot
3. practice swing and try to fill the bar to the required head speed level
4. disable practice swing mode and do the real swing with the same head speed as the practice swing as possible


any question?






---
when fill the bar make it animate from bottom and fill up 




---
add spin


---


---
beside club smash factor
add character smash factor so
ball speed = swing speed * club smash factor * character smash factor

character smash factor  =  character power stat^2

data struct
add character stats 
1. power : 
2. Control : TBD
3. Impact: : TBD
4. Spin:: TBD
5. Curve:: TBD

default character current is "Nuri"
which has power = 4







---
add top-down mode
when press T will switch to another camera mode "top down"


top down mode camera will start by looking down at the aiming point *default height=10m 
 ball's vertical line as pivot when rotate (with left/right)

                 cam
                  |
                  |
ball-------------hole



note1: press T again will go back to normal camera
press F will go to free camera

note 2: when press down will move the camera closer to ball
press up will move camera further from ball

any question?
