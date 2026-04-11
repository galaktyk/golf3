https://help.opengolfsim.com/desktop/apis/shot-data/



the aim logic now will be dynamic!!!
when player press up or down key, this will adjust the head speed of the preview




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
