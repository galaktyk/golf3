https://help.opengolfsim.com/desktop/apis/shot-data/







i want to implement the club hit ball to launch the ball

1. lets add some sphere collider at the club head (all club model file will have 0,0 as grip and tip on top (y)) we could offset it down a bit and add a sphere collider with radius of 0.1m to approximate the club head
visualize the collider too, for now

2. when the club hit the ball, we can calculate the ball speed and launch angle based on the club head speed and orientation at the moment of impact.

launch data object:
    "ballSpeed" <from swing speed>: ,
    "verticalLaunchAngle"  use 15 for now: ,
    "horizontalLaunchAngle" based on character orientation +- with arrival direction of the club head: ,
    "spinSpeed": dummy for now,
    "spinAxis": dummy for now

(use metric system)
add ui show this info on the right when ball moving, for debugging purpose

3. have ball state machine like
"ready" -> "moving"

in the moving have [air, ground, rest]


3. have player state machine like
    "control" → "waiting" → "control"
when hit ball, go to "waiting" state, and wait for ball to stop, then go back to "control" state
and warp player back to the ball position for next shot


