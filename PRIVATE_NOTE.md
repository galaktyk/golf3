https://help.opengolfsim.com/desktop/apis/shot-data/




---
bounce feel unnatural
it push forward too much even i use sand wedge with high loft
after it bounce it go forward too much, could you check the physics?


---

refactor how camera work
normally when press left/right will rotate camera
and press up/down will adjust aimpreview

now when press up/down will warp camera to the near contact preview position and look at it (along with adjusting the aim preview)
in that mode when press left/right will still rotate character and aim preview but the camera will follow the near contact preview position and look at it

press space will exit the aiming mode and warp camera back to normal position

in total now we have 3 camera mode
1. normal mode
2. aiming mode
3. free camera mode


*we might need to reconsider how character and camera and ball hierarchy work in the scene to make this easier to implement and less buggy






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
