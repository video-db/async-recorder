from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid
from app.db.database import get_db
from app.db.models import User
from app.services.videodb import videodb_service

router = APIRouter()

class RegisterRequest(BaseModel):
    name: str
    api_key: str

@router.post("/register")
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    # Validate API Key using SDK
    if not videodb_service.verify_api_key(request.api_key):
        raise HTTPException(status_code=400, detail="Invalid VideoDB API Key")

    # Generate Access Token
    access_token = str(uuid.uuid4())
    
    # Save User
    new_user = User(
        name=request.name, 
        api_key=request.api_key, 
        access_token=access_token
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    response = {
        "access_token": new_user.access_token,
        "name": new_user.name,
    }
    if videodb_service.config.VIDEODB_API_URL:
        response["backend_base_url"] = videodb_service.config.VIDEODB_API_URL
    return response
